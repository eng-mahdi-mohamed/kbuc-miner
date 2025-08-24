/**
 * Web Server with REST API for KBUC Mining System
 * Web Server with REST API for KBUC Mining System
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const BlockchainBroadcaster = require('./BlockchainBroadcaster');

class WebServer {
    constructor(config, logger, miningSystem) {
        this.config = config;
        this.logger = logger.child({ component: 'WebServer' });
        this.miningSystem = miningSystem;
        
        // Initialize blockchain broadcaster
        this.blockchainBroadcaster = new BlockchainBroadcaster(config, this.logger);
        
        this.app = express();
        this.server = null;
        this.isRunning = false;
        this.wss = null;
        this.wsClients = new Set();
        this.wsIntervals = { stats: null, health: null };
        
        // Setup middleware
        this.setupMiddleware();
        
        // Setup routes
        this.setupRoutes();
        
        // Setup error handling
        this.setupErrorHandling();
    }

    /**
     * Initialize web server
     * تهيئة خادم الويب
     */
    async initialize() {
        try {
            this.logger.debug('Initializing web server...');

            // Setup security headers
            this.setupSecurity();

            // Setup rate limiting
            this.setupRateLimiting();

            this.logger.info('✅ Web server initialized successfully');

        } catch (error) {
            this.logger.error('Failed to initialize web server', { error: error.message });
            throw error;
        }
    }

    /**
     * Setup middleware
     * إعداد الوسائط
     */
    setupMiddleware() {
        // Security middleware
        this.app.use(helmet({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    styleSrc: ["'self'", "'unsafe-inline'"],
                    scriptSrc: ["'self'"],
                    imgSrc: ["'self'", "data:", "https:"],
                },
            },
        }));

        // CORS
        const corsConfig = this.config.get('security.cors');
        if (corsConfig.enabled) {
            this.app.use(cors({
                origin: corsConfig.origins,
                credentials: true
            }));
        }

        // Compression
        this.app.use(compression());

        // Body parsing
        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

        // Logging
        this.app.use(morgan('combined', {
            stream: {
                write: (message) => {
                    this.logger.info(message.trim());
                }
            }
        }));
    }

    /**
     * Setup security
     * إعداد الأمان
     */
    setupSecurity() {
        // API key middleware (supports both new and legacy locations)
        const apiKey = this.config.get('security.authentication.apiKey') || this.config.get('security.apiKey');
        if (apiKey) {
            this.app.use((req, res, next) => {
                const providedKey = req.headers['x-api-key'] || req.query.apiKey;
                
                if (!providedKey || providedKey !== apiKey) {
                    return res.status(401).json({
                        error: 'Unauthorized',
                        message: 'Invalid API key'
                    });
                }
                
                next();
            });
        }
    }

    /**
     * Setup rate limiting
     * إعداد تحديد المعدل
     */
    setupRateLimiting() {
        const rateLimitConfig = this.config.get('security.rateLimit');
        
        if (rateLimitConfig.enabled) {
            const rateLimit = require('express-rate-limit');
            
            const limiter = rateLimit({
                windowMs: rateLimitConfig.windowMs,
                max: rateLimitConfig.maxRequests,
                message: {
                    error: 'Too many requests',
                    message: 'Rate limit exceeded'
                },
                standardHeaders: true,
                legacyHeaders: false,
            });
            
            this.app.use(limiter);
        }
    }

    /**
     * Setup routes
     * إعداد المسارات
     */
    setupRoutes() {
        // Health check
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                uptime: process.uptime()
            });
        });

        // System info
        this.app.get('/api/system/info', (req, res) => {
            res.json({
                name: this.config.get('system.name'),
                version: this.config.get('system.version'),
                environment: this.config.get('system.environment'),
                platform: process.platform,
                arch: process.arch,
                nodeVersion: process.version
            });
        });

        // Mining status
        this.app.get('/api/mining/status', async (req, res) => {
            try {
                const stats = await this.miningSystem.getStats();
                res.json(stats);
            } catch (error) {
                this.logger.error('Failed to get mining status', { error: error.message });
                res.status(500).json({
                    error: 'Internal server error',
                    message: error.message
                });
            }
        });

        // Start mining
        this.app.post('/api/mining/start', async (req, res) => {
            try {
                const { hash, leader_address, reward_address, block_height, timestamp, target, mining_type } = req.body;

                // If mining is already running, return conflict
                if (this.miningSystem.isRunning) {
                    return res.status(409).json({
                        error: 'Conflict',
                        message: 'Mining already running'
                    });
                }

                await this.miningSystem.start();
                const session = this.miningSystem.currentSession;
                res.json({
                    success: true,
                    sessionId: session?.id,
                    message: 'Mining started successfully'
                });
            } catch (error) {
                this.logger.error('Failed to start mining', { error: error.message });
                res.status(500).json({
                    error: 'Internal server error',
                    message: error.message
                });
            }
        });

        // Stop mining
        this.app.post('/api/mining/stop', async (req, res) => {
            try {
                const { sessionId } = req.body;
                
                if (!sessionId) {
                    return res.status(400).json({
                        error: 'Bad request',
                        message: 'Session ID is required'
                    });
                }

                await this.miningSystem.stop();
                res.json({
                    success: true,
                    message: 'Mining stopped successfully'
                });
            } catch (error) {
                this.logger.error('Failed to stop mining', { error: error.message });
                res.status(500).json({
                    error: 'Internal server error',
                    message: error.message
                });
            }
        });

        // Restart mining
        this.app.post('/api/mining/restart', async (req, res) => {
            try {
                const { reason = 'manual', force = false } = req.body;
                
                // Validate reason
                const validReasons = ['manual', 'error_recovery', 'webgpu_error', 'worker_error', 'device_error'];
                if (!validReasons.includes(reason)) {
                    return res.status(400).json({
                        error: 'Bad request',
                        message: 'Invalid restart reason'
                    });
                }

                await this.miningSystem.restartMining(reason);
                this.logger.info('Mining restart requested via API', { reason, force });
                res.json({
                    success: true,
                    message: 'Mining restart initiated',
                    reason: reason,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                this.logger.error('Failed to restart mining', { error: error.message });
                res.status(500).json({
                    error: 'Internal server error',
                    message: error.message
                });
            }
        });

        // Pause mining (preserve session state)
        this.app.post('/api/mining/pause', async (req, res) => {
            try {
                if (!this.miningSystem.currentSession) {
                    return res.status(409).json({
                        error: 'Conflict',
                        message: 'No active session to pause'
                    });
                }

                const result = await this.miningSystem.pause();
                if (!result.paused) {
                    return res.status(400).json({
                        error: 'Bad request',
                        message: result.reason || 'Unable to pause'
                    });
                }

                res.json({
                    success: true,
                    message: 'Mining paused',
                    sessionId: result.sessionId
                });
            } catch (error) {
                this.logger.error('Failed to pause mining', { error: error.message });
                res.status(500).json({
                    error: 'Internal server error',
                    message: error.message
                });
            }
        });

        // Resume mining (use existing paused session)
        this.app.post('/api/mining/resume', async (req, res) => {
            try {
                const result = await this.miningSystem.resume();
                if (!result.resumed) {
                    return res.status(409).json({
                        error: 'Conflict',
                        message: result.reason || 'Unable to resume',
                        sessionId: result.sessionId || null
                    });
                }

                res.json({
                    success: true,
                    message: 'Mining resumed',
                    sessionId: result.sessionId
                });
            } catch (error) {
                this.logger.error('Failed to resume mining', { error: error.message });
                res.status(500).json({
                    error: 'Internal server error',
                    message: error.message
                });
            }
        });

        // Get mining health
        this.app.get('/api/mining/health', async (req, res) => {
            try {
                const health = await this.miningSystem.getHealth();
                res.json(health);
            } catch (error) {
                this.logger.error('Failed to get mining health', { error: error.message });
                res.status(500).json({
                    error: 'Internal server error',
                    message: error.message
                });
            }
        });

        // Toggle test mode
        this.app.post('/api/mining/test-mode', async (req, res) => {
            try {
                const { enabled, timeoutSeconds } = req.body;
                
                if (typeof enabled !== 'boolean') {
                    return res.status(400).json({
                        error: 'Bad request',
                        message: 'enabled field must be boolean'
                    });
                }

                // Set environment variable for immediate effect
                process.env.TEST_MODE = enabled ? 'true' : 'false';
                
                const result = {
                    success: true,
                    testMode: enabled,
                    timeoutSeconds: timeoutSeconds || (enabled ? 120 : 1800),
                    message: enabled ? 
                        `Test mode enabled (${timeoutSeconds || 120}s timeout)` : 
                        'Test mode disabled (production timeout)',
                    timestamp: new Date().toISOString()
                };
                
                this.logger.info('Test mode toggled via API', {
                    enabled,
                    timeoutSeconds: result.timeoutSeconds
                });
                
                res.json(result);
            } catch (error) {
                this.logger.error('Failed to toggle test mode', { error: error.message });
                res.status(500).json({
                    error: 'Internal server error',
                    message: error.message
                });
            }
        });

        // Get statistics
        this.app.get('/api/mining/stats', async (req, res) => {
            try {
                const stats = await this.miningSystem.getStats();
                res.json(stats);
            } catch (error) {
                this.logger.error('Failed to get mining stats', { error: error.message });
                res.status(500).json({
                    error: 'Internal server error',
                    message: error.message
                });
            }
        });

        // Get configuration
        this.app.get('/api/config', (req, res) => {
            try {
                // Return full config so UI sees all sections (system, network, mining, engines, storage, logging, monitoring, security, etc.)
                const full = (typeof this.config.getAll === 'function') ? this.config.getAll() : {
                    system: this.config.get('system'),
                    network: this.config.get('network'),
                    mining: this.config.get('mining'),
                    performance: this.config.get('performance'),
                    engines: this.config.get('engines'),
                    storage: this.config.get('storage'),
                    logging: this.config.get('logging'),
                    monitoring: this.config.get('monitoring'),
                    security: this.config.get('security'),
                };
                res.json(full);
            } catch (error) {
                this.logger.error('Failed to get configuration', { error: error.message });
                res.status(500).json({
                    error: 'Internal server error',
                    message: error.message
                });
            }
        });

        // Update configuration
        this.app.put('/api/config', async (req, res) => {
            try {
                const updates = req.body;
                
                // Validate updates
                if (!updates || typeof updates !== 'object') {
                    return res.status(400).json({
                        error: 'Bad request',
                        message: 'Invalid configuration updates'
                    });
                }

                await this.config.update(updates);
                res.json({
                    success: true,
                    message: 'Configuration updated successfully'
                });
            } catch (error) {
                this.logger.error('Failed to update configuration', { error: error.message });
                res.status(500).json({
                    error: 'Internal server error',
                    message: error.message
                });
            }
        });

        // Get logs
        this.app.get('/api/logs', (req, res) => {
            try {
                const { level = 'info', limit = 100 } = req.query;
                
                // This would read from log files
                const logs = [
                    {
                        timestamp: new Date().toISOString(),
                        level: 'info',
                        message: 'System started'
                    }
                ];
                
                res.json(logs);
            } catch (error) {
                this.logger.error('Failed to get logs', { error: error.message });
                res.status(500).json({
                    error: 'Internal server error',
                    message: error.message
                });
            }
        });

        // Get alerts
        this.app.get('/api/alerts', (req, res) => {
            try {
                const { severity, limit = 50 } = req.query;
                
                // This would get alerts from the monitoring system
                const alerts = [];
                
                res.json(alerts);
            } catch (error) {
                this.logger.error('Failed to get alerts', { error: error.message });
                res.status(500).json({
                    error: 'Internal server error',
                    message: error.message
                });
            }
        });

        // Broadcast solution endpoint
        this.app.post('/mine/broadcast', async (req, res) => {
            try {
                const { nonce, hash, sessionId, ticket_data, leader_address, reward_address, block_height, mining_type, timestamp } = req.body;
                
                // Validate required fields
                if (!nonce || !hash) {
                    return res.status(400).json({
                        error: 'Bad request',
                        message: 'Nonce and hash are required'
                    });
                }

                this.logger.info('Received broadcast request', { 
                    nonce, 
                    hash, 
                    sessionId 
                });

                // Create solution object
                const solution = {
                    nonce: parseInt(nonce),
                    hash: hash,
                    config: {
                        ticket_data: ticket_data,
                        leader_address: leader_address,
                        reward_address: reward_address,
                        block_height: parseInt(block_height),
                        mining_type: parseInt(mining_type) || 0,
                        timestamp: parseInt(timestamp)
                    },
                };

                // Broadcast to blockchain
                const broadcastSuccess = await this.blockchainBroadcaster.broadcastSupportTicket(solution);
                
                const result = {
                    success: broadcastSuccess,
                    message: broadcastSuccess ? 'Solution broadcasted successfully' : 'Failed to broadcast solution',
                    nonce: nonce,
                    hash: hash,
                    timestamp: new Date().toISOString()
                };
                
                res.json(result);
            } catch (error) {
                this.logger.error('Failed to broadcast solution', { error: error.message });
                res.status(500).json({
                    error: 'Internal server error',
                    message: error.message
                });
            }
        });

        // WebSocket endpoint hint (HTTP) for real-time updates
        this.app.get('/api/ws', (req, res) => {
            res.status(426).json({
                error: 'Upgrade Required',
                message: 'Use WebSocket protocol to connect to this endpoint'
            });
        });

        // Dashboard endpoint
        this.app.get('/api/dashboard', async (req, res) => {
            try {
                // Get system and mining stats in parallel
                const [stats, health] = await Promise.all([
                    this.miningSystem.getStats(),
                    this.miningSystem.getHealth()
                ]);

                // Get system memory usage
                const memoryUsage = process.memoryUsage();
                const systemMemoryUsage = (memoryUsage.heapUsed / 1024 / 1024).toFixed(2);
                const systemMemoryTotal = (memoryUsage.heapTotal / 1024 / 1024).toFixed(2);

                const dashboard = {
                    system: {
                        status: 'running',
                        uptime: process.uptime(),
                        memory: {
                            used: parseFloat(systemMemoryUsage),
                            total: parseFloat(systemMemoryTotal),
                            usage: ((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100).toFixed(2)
                        },
                        nodeVersion: process.version,
                        platform: process.platform,
                        arch: process.arch
                    },
                    mining: {
                        status: this.miningSystem.isRunning ? 'running' : 'stopped',
                        hashRate: stats?.hashRate || 0,
                        totalHashes: stats?.totalHashes || 0,
                        solutions: stats?.solutions || 0,
                        difficulty: stats?.difficulty || 0,
                        workers: health?.workers || {}
                    },
                    network: {
                        host: this.config.get('network.api.host'),
                        port: this.config.get('network.api.port'),
                        peers: stats?.peers || 0
                    },
                    version: this.config.get('system.version'),
                    timestamp: new Date().toISOString()
                };
                
                res.json(dashboard);
            } catch (error) {
                this.logger.error('Failed to get dashboard data', { error: error.message });
                res.status(500).json({
                    error: 'Internal server error',
                    message: error.message
                });
            }
        });

        // API documentation
        this.app.get('/api/docs', (req, res) => {
            const docs = {
                title: 'KBUC Mining API',
                version: '1.0.0',
                endpoints: {
                    'GET /health': 'Health check',
                    'GET /api/system/info': 'Get system information',
                    'GET /api/mining/status': 'Get mining status',
                    'POST /api/mining/start': 'Start mining',
                    'POST /api/mining/stop': 'Stop mining',
                    'POST /api/mining/restart': 'Restart mining (body: {reason, force})',
                    'POST /api/mining/pause': 'Pause mining (preserves current session state)',
                    'POST /api/mining/resume': 'Resume mining from paused session',
                    'GET /api/mining/session': 'Get current session info (or by id with ?id=...)',
                    'GET /api/mining/sessions': 'List sessions with safe metadata',
                    'GET /api/mining/health': 'Get mining system health',
                    'POST /api/mining/test-mode': 'Toggle test mode (body: {enabled, timeoutSeconds})',
                    'GET /api/mining/stats': 'Get mining statistics',
                    'GET /api/config': 'Get configuration',
                    'PUT /api/config': 'Update configuration',
                    'GET /api/logs': 'Get system logs',
                    'GET /api/alerts': 'Get system alerts',
                    'GET /api/dashboard': 'Get dashboard data'
                }
            };
            
            res.json(docs);
        });

        // Session info (current or by id)
        this.app.get('/api/mining/session', (req, res) => {
            try {
                const { id } = req.query;
                const info = this.miningSystem.getSessionInfo(id);
                if (!info) {
                    return res.status(404).json({
                        error: 'Not found',
                        message: 'Session not found'
                    });
                }
                res.json(info);
            } catch (error) {
                this.logger.error('Failed to get session info', { error: error.message });
                res.status(500).json({
                    error: 'Internal server error',
                    message: error.message
                });
            }
        });

        // List sessions
        this.app.get('/api/mining/sessions', (req, res) => {
            try {
                const sessions = this.miningSystem.listSessions();
                res.json(sessions);
            } catch (error) {
                this.logger.error('Failed to list sessions', { error: error.message });
                res.status(500).json({
                    error: 'Internal server error',
                    message: error.message
                });
            }
        });

        // Serve built dashboard if available (production)
        try {
            const distPath = path.resolve(process.cwd(), 'dashboard', 'dist');
            if (fs.existsSync(distPath)) {
                this.logger.info('Serving dashboard static files', { distPath });
                this.app.use(express.static(distPath));
                // SPA fallback for non-API routes
                this.app.get(/^(?!\/api\/).*/, (req, res) => {
                    res.sendFile(path.join(distPath, 'index.html'));
                });
            }
        } catch (e) {
            this.logger.warn('Failed to set up static dashboard serving (non-fatal)', { error: e.message });
        }
    }

    /**
     * Setup error handling
     * إعداد معالجة الأخطاء
     */
    setupErrorHandling() {
        // 404 handler
        this.app.use((req, res) => {
            res.status(404).json({
                error: 'Not found',
                message: `Route ${req.method} ${req.path} not found`
            });
        });

        // Error handler
        this.app.use((error, req, res, next) => {
            this.logger.error('Unhandled error', {
                error: error.message,
                stack: error.stack,
                url: req.url,
                method: req.method
            });

            res.status(500).json({
                error: 'Internal server error',
                message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
            });
        });
    }

    /**
     * Start web server
     * بدء خادم الويب
     */
    async start() {
        try {
            this.logger.info('Starting web server...');

            const host = this.config.get('network.api.host', 'localhost');
            const port = this.config.get('network.api.port', 8001);

            return new Promise((resolve, reject) => {
                this.server = this.app.listen(port, host, () => {
                    this.isRunning = true;
                    this.logger.info(`Web server started on http://${host}:${port}`);
                    // Initialize WebSocket server on the same HTTP server
                    try {
                        this.setupWebSocketServer();
                    } catch (e) {
                        this.logger.error('Failed to start WebSocket server', { error: e.message });
                    }
                    resolve();
                });

                this.server.on('error', (error) => {
                    this.logger.error('Web server error', { error: error.message });
                    reject(error);
                });
            });

        } catch (error) {
            this.logger.error('Failed to start web server', { error: error.message });
            throw error;
        }
    }

    /**
     * Stop web server
     * إيقاف خادم الويب
     */
    async stop() {
        try {
            this.logger.info('Stopping web server...');

            // Stop WebSocket broadcast loops and close WS server/clients
            try {
                this.stopBroadcastLoops();
            } catch (e) {
                this.logger.debug('Error stopping WS broadcast loops (non-fatal)', { error: e.message });
            }

            if (this.wss) {
                try {
                    // Terminate all clients to unblock close
                    for (const client of this.wsClients) {
                        try { client.terminate(); } catch {}
                    }
                    this.wsClients.clear();
                } catch (e) {
                    this.logger.debug('Error terminating WS clients (non-fatal)', { error: e.message });
                }

                try { this.wss.close(); } catch {}
                this.wss = null;
            }

            if (this.server) {
                return new Promise((resolve) => {
                    this.server.close(() => {
                        this.isRunning = false;
                        this.server = null;
                        this.logger.info('Web server stopped');
                        resolve();
                    });
                });
            }

        } catch (error) {
            this.logger.error('Failed to stop web server', { error: error.message });
            throw error;
        }
    }

    /**
     * Get server status
     * الحصول على حالة الخادم
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            host: this.config.get('network.api.host'),
            port: this.config.get('network.api.port'),
            uptime: this.server ? this.server.uptime : 0
        };
    }

    /**
     * Setup WebSocket server for real-time updates
     */
    setupWebSocketServer() {
        if (!this.server) throw new Error('HTTP server not started');

        this.wss = new WebSocket.Server({ server: this.server, path: '/api/ws' });
        this.logger.info('WebSocket server initialized at /api/ws');

        this.wss.on('connection', (ws, req) => {
            try {
                // API key auth: header or query
                const expectedKey = this.config.get('security.authentication.apiKey');
                if (expectedKey) {
                    const url = new URL(req.url, `http://${req.headers.host}`);
                    const keyFromQuery = url.searchParams.get('apiKey');
                    const keyFromHeader = req.headers['x-api-key'];
                    const provided = keyFromHeader || keyFromQuery;
                    if (!provided || provided !== expectedKey) {
                        try { ws.close(1008, 'Invalid API key'); } catch {}
                        return;
                    }
                }

                this.wsClients.add(ws);
                ws.send(this.safeJson({ type: 'ready', data: { message: 'connected' }, ts: Date.now() }));

                // Start broadcast loops when first client connects
                this.startBroadcastLoops();

                ws.on('close', () => {
                    this.wsClients.delete(ws);
                    if (this.wsClients.size === 0) this.stopBroadcastLoops();
                });

                ws.on('error', (err) => {
                    this.logger.debug('WebSocket client error', { error: err.message });
                });
            } catch (e) {
                this.logger.error('WebSocket connection error', { error: e.message });
                try { ws.close(1011, 'Internal error'); } catch {}
            }
        });
    }

    startBroadcastLoops() {
        if (!this.wsIntervals.stats) {
            this.wsIntervals.stats = setInterval(async () => {
                try {
                    const stats = await this.miningSystem.getStats();
                    this.broadcast('stats', stats);
                } catch (e) {
                    this.logger.debug('Failed to broadcast stats', { error: e.message });
                }
            }, 1000);
        }
        if (!this.wsIntervals.health) {
            this.wsIntervals.health = setInterval(async () => {
                try {
                    if (typeof this.miningSystem.getHealth === 'function') {
                        const health = await this.miningSystem.getHealth();
                        this.broadcast('health', health);
                    }
                } catch (e) {
                    this.logger.debug('Failed to broadcast health', { error: e.message });
                }
            }, 5000);
        }
    }

    stopBroadcastLoops() {
        if (this.wsIntervals.stats) { clearInterval(this.wsIntervals.stats); this.wsIntervals.stats = null; }
        if (this.wsIntervals.health) { clearInterval(this.wsIntervals.health); this.wsIntervals.health = null; }
    }

    broadcast(type, data) {
        if (!this.wsClients || this.wsClients.size === 0) return;
        const payload = this.safeJson({ type, data, ts: Date.now() });
        for (const client of this.wsClients) {
            if (client.readyState === WebSocket.OPEN) {
                try { client.send(payload); } catch {}
            }
        }
    }

    safeJson(obj) {
        try { return JSON.stringify(obj); } catch { return '{}'; }
    }
}

module.exports = WebServer; 