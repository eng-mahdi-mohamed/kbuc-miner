/**
 * Mining System for KBUC
 * نظام التعدين لـ KBUC
 */

const { Worker } = require('worker_threads');
const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// Import mining engines
const GPUMiner = require('../engines/GPUMiner');
const CPUMiner = require('../engines/CPUMiner');
const BlockchainDataManager = require('./BlockchainDataManager');
const BlockchainBroadcaster = require('./BlockchainBroadcaster');

class MiningSystem {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger.child({ component: 'MiningSystem' });
        
        // Initialize blockchain data manager
        this.blockchainDataManager = new BlockchainDataManager(config, this.logger);
        
        // Initialize blockchain broadcaster
        this.blockchainBroadcaster = new BlockchainBroadcaster(config, this.logger);
        
        // Mining engines
        this.gpuMiner = null;
        this.cpuMiner = null;
        
        // State management
        this.isRunning = false;
        this.currentSession = null;
        this.sessions = new Map();
        this.stats = {
            startTime: Date.now(),
            hashRate: 0,
            totalHashes: 0,
            solutions: 0,
            errors: 0,
            restarts: 0
        };
        
        // Performance tracking
        this.performanceHistory = [];
        this.lastUpdate = Date.now();
        
        // Event handlers
        this.eventHandlers = new Map();
        
        // Solution tracking to prevent duplicates
        this.foundSolutions = new Set();
        this.solutionLock = new Map(); // Track solutions being processed

        // Track session timeouts so we can clear them on pause/stop
        this.sessionTimeouts = new Map();

        // Lifecycle intent: whether the user intends mining to be running.
        // This protects against race conditions where timers/errors trigger during pause.
        this.shouldRun = false;
    }

    /**
     * Handle miner metrics (real-time)
     * إدارة مقاييس المحرك لحظيًا على مستوى النظام
     */
    handleMinerMetrics(sessionId, metrics) {
        try {
            const session = this.sessions.get(sessionId);
            if (!session) return;

            // Update current nonce at system level for visibility
            try {
                session.meta = session.meta || {};
                if (Number.isFinite(metrics?.lastNonce)) {
                    session.meta.currentNonce = metrics.lastNonce >>> 0;
                    // Keep session.config.base_nonce aligned so that any miner self-restart resumes from last known nonce
                    try {
                        session.config = session.config || {};
                        // Use currentNonce as base; worker will continue from here (off-by-one duplication is harmless)
                        session.config.base_nonce = session.meta.currentNonce >>> 0;
                    } catch {}
                }
            } catch {}

            // Update system stats in real-time
            if (Number.isFinite(metrics?.rate)) {
                this.stats.hashRate = Math.max(0, metrics.rate);
            }
            // Accumulate total hashes across miner restarts using delta from miner-reported counter
            if (Number.isFinite(metrics?.totalHashes)) {
                const minerTotal = metrics.totalHashes >>> 0;
                const last = session.meta.lastMinerTotalHashes;
                if (typeof last === 'number' && Number.isFinite(last)) {
                    if (minerTotal >= last) {
                        session.meta.totalHashesAcc += (minerTotal - last);
                    } else {
                        // Counter reset (restart). Add the new segment fully.
                        session.meta.totalHashesAcc += minerTotal;
                    }
                } else {
                    // First observation in this session segment
                    session.meta.totalHashesAcc += minerTotal;
                }
                // Update baseline to current miner total
                session.meta.lastMinerTotalHashes = minerTotal;
                // Reflect aggregated total in system stats
                this.stats.totalHashes = Math.max(0, session.meta.totalHashesAcc >>> 0);
            }

            // Keep short performance history
            this.performanceHistory.push({
                timestamp: Date.now(),
                hashRate: this.stats.hashRate,
                totalHashes: this.stats.totalHashes,
                cpuUsage: 0,
                memoryUsage: 0,
            });
            if (this.performanceHistory.length > 100) {
                this.performanceHistory = this.performanceHistory.slice(-100);
            }
            this.lastUpdate = Date.now();
        } catch (e) {
            this.logger.debug && this.logger.debug('handleMinerMetrics error (non-fatal)', { sessionId, error: e.message });
        }
    }

    /**
     * Initialize the mining system
     * تهيئة نظام التعدين
     */
    async initialize() {
        try {
            this.logger.debug('Initializing mining system...');

            // Initialize mining engines
            await this.initializeEngines();

            // Load previous state if exists
            await this.loadState();

            // Setup event handlers
            this.setupEventHandlers();

            this.logger.info('✅ Mining system initialized successfully');
            
        } catch (error) {
            this.logger.error('Failed to initialize mining system', { error: error.message });
            throw error;
        }
    }

    /**
     * Initialize mining engines
     * تهيئة محركات التعدين
     */
    async initializeEngines() {
        const gpuConfig = this.config.get('engines.gpu');
        const cpuConfig = this.config.get('engines.cpu');

        // Initialize GPU miners if enabled
        if (gpuConfig.enabled) {

            try {
                const GPUMiner = require('../engines/GPUMiner');
                this.webgpuMiner = new GPUMiner(this.config, this.logger);
                await this.webgpuMiner.initialize();
            } catch (error) {
                this.logger.warn('⚠️ Failed to initialize WebGPU miner', { 
                    error: error.message,
                    stack: error.stack,
                    type: error.constructor.name
                });
                
                // Provide helpful suggestions
                if (error.message.includes('adapter') || error.message.includes('device')) {
                    this.logger.warn('💡 WebGPU suggestions:');
                    this.logger.warn('   - Update your GPU drivers');
                    this.logger.warn('   - Check if your GPU supports WebGPU');
                    this.logger.warn('   - Try running: node test-webgpu-diagnostic.js');
                }
                this.webgpuMiner = null;
            }
        }

        // Initialize CPU miner (always available as fallback)
        this.cpuMiner = new CPUMiner(this.config, this.logger);
        await this.cpuMiner.initialize();
    }

    /**
     * Start the mining system
     * بدء نظام التعدين
     */
    async start() {
        try {
            this.logger.debug('Starting mining system...');

            // Mark user intent to run
            this.shouldRun = true;

            if (this.isRunning) {
                this.logger.warn('Mining system is already running');
                return;
            }

            // Create new mining session
            const sessionId = uuidv4();
            this.currentSession = {
                id: sessionId,
                startTime: Date.now(),
                // config: DEFAULT_CONFIG,
                config: await this.getMiningConfig(),
                status: 'starting',
                // Initialize session meta for higher-level state tracking
                meta: {
                    nonceRollovers: 0,
                    currentNonce: 0,
                    // Accumulate total hashes across miner restarts
                    totalHashesAcc: 0,
                    lastMinerTotalHashes: undefined,
                    // Accumulate solutions across miner restarts (session-scoped)
                    solutionsAcc: 0,
                    lastMinerSolutions: undefined,
                }
            };

            this.sessions.set(sessionId, this.currentSession);

            // Start mining with timeout management
            await this.startMiningWithTimeout(sessionId);

            this.isRunning = true;
            this.stats.startTime = Date.now();
            
            this.logger.info('Mining system started successfully', { sessionId });

        } catch (error) {
            this.logger.error('Failed to start mining system', { error: error.message });
            throw error;
        }
    }

    /**
     * Start mining with appropriate engine
     * بدء التعدين بالمحرك المناسب
     */
    async startMining(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error('Session not found');
        }

        try {
            // Determine which miner to use
            const miner = this.selectMiner();
            
            if (!miner) {
                throw new Error('No available mining engine');
            }

            // Set solution callback for the miner
            if (miner.setSolutionCallback) {
                miner.setSolutionCallback((sessionId, solution) => this.handleSolution(sessionId, solution));
            }
            // Set error callback for the miner (e.g., nonce exhaustion, device lost, worker exit)
            if (miner.setErrorCallback) {
                miner.setErrorCallback((err) => this.handleMinerError(sessionId, err));
            }
            // Set metrics callback for real-time stats and nonce tracking at system level
            if (miner.setMetricsCallback) {
                miner.setMetricsCallback((sid, metrics) => this.handleMinerMetrics(sessionId, metrics));
            }
            // Start mining
            // Ensure base_nonce reflects last known progress when (re)starting miner
            try {
                session.meta = session.meta || {};
                session.config = session.config || {};
                if (Number.isFinite(session.meta.currentNonce)) {
                    session.config.base_nonce = session.meta.currentNonce >>> 0;
                }
            } catch {}
            await miner.start(session);
            
            session.status = 'running';
            session.miner = miner;

            this.logger.info('✅ Mining started', { 
                sessionId, 
                miner: miner.constructor.name,
                config: session.config 
            });

        } catch (error) {
            session.status = 'error';
            this.logger.error('Failed to start mining', { 
                sessionId, 
                error: error.message 
            });
            throw error;
        }
    }

    /**
     * Select the best mining engine
     * اختيار أفضل محرك تعدين
     */
    selectMiner() {
        const gpuConfig = this.config.get('engines.gpu');
        const cpuConfig = this.config.get('engines.cpu');

        if (gpuConfig?.enabled && this.webgpuMiner) {
            return this.webgpuMiner;
        }

        if (this.cpuMiner) {
            this.logger.info('GPU not available, using CPU miner (always available)');
            return this.cpuMiner;
        }

        return null;
    }

    /**
     * Get mining configuration with support ticket data
     * Support ticket data is fetched once at mining start and remains constant during nonce search
     */
    async getMiningConfig() {
        try {
            // Get support ticket data (fetched once, remains constant during mining)
            const { leaderAddress, blockHeight } = await this.blockchainDataManager.getSupportableLeader();
            
            this.logger.debug('Mining session configuration', {
                leaderAddress,
                blockHeight,
                note: 'Support ticket data will remain constant during nonce search'
            });
            
            // Use a fixed timestamp for the entire mining session
            
            return {
                ticket_data: this.config.get('mining.blockchain.defaultTicketData'),
                leader_address: leaderAddress,
                reward_address: this.config.get('mining.blockchain.defaultRewardAddress'),
                block_height: blockHeight,
                timestamp: Math.floor(Date.now() / 1000),
                difficulty_target: this.config.get('mining.blockchain.defaultDifficultyTarget'),
                mining_type: this.config.get('mining.blockchain.defaultMiningType'),
                timeLimit: this.config.get('mining.session.maxTimeSeconds', 0) // Time limit in seconds
            };
        } catch (error) {
            this.logger.error('Failed to get mining config with support ticket data', { error: error.message });
            
            // Fallback to static config
            this.logger.warn('Using fallback configuration due to RPC failure');
            return null;
        }
    }

    /**
     * Stop the mining system
     * إيقاف نظام التعدين
     */
    async stop() {
        try {
            this.logger.debug('Stopping mining system...');

            if (!this.isRunning) {
                this.logger.warn('Mining system is not running');
                return;
            }

            // Stop all active sessions
            for (const [sessionId, session] of this.sessions) {
                if (session.status === 'running' && session.miner) {
                    await session.miner.stop();
                    session.status = 'stopped';
                    this.logger.logMiningStop(sessionId, 'manual_stop');
                }
            }

            // Clear session timeouts
            for (const handle of this.sessionTimeouts.values()) {
                clearTimeout(handle);
            }
            this.sessionTimeouts.clear();

            // Clear run intent
            this.shouldRun = false;

            this.isRunning = false;
            this.currentSession = null;

            // Save state
            await this.saveState();

            this.logger.info('Mining system stopped successfully');

        } catch (error) {
            this.logger.error('Failed to stop mining system', { error: error.message });
            throw error;
        }
    }

    /**
     * Pause current mining session (preserve state)
     * إيقاف الجلسة مؤقتًا مع الحفاظ على الحالة
     */
    async pause() {
        try {
            this.logger.debug('Pausing mining system...');

            if (!this.currentSession) {
                this.logger.warn('No active session to pause');
                return { paused: false, reason: 'no_session' };
            }

            const session = this.currentSession;
            if (session.status === 'paused') {
                this.logger.info('Mining session already paused', { sessionId: session.id });
                return { paused: true, sessionId: session.id };
            }

            if (session.miner) {
                await session.miner.stop();
            }

            session.status = 'paused';
            this.isRunning = false;

            // Clear run intent while paused to block any auto restarts
            this.shouldRun = false;

            // Clear session timeouts to ensure no auto-restarts while paused
            for (const handle of this.sessionTimeouts.values()) {
                clearTimeout(handle);
            }
            this.sessionTimeouts.clear();

            await this.saveState();
            this.logger.info('Mining session paused', { sessionId: session.id });
            return { paused: true, sessionId: session.id };
        } catch (error) {
            this.logger.error('Failed to pause mining', { error: error.message });
            throw error;
        }
    }

    /**
     * Resume paused mining session
     * استئناف جلسة التعدين الموقوفة مؤقتًا
     */
    async resume() {
        try {
            this.logger.debug('Resuming mining system...');

            if (this.isRunning) {
                this.logger.warn('Mining system already running');
                return {
                    resumed: false,
                    reason: 'already_running',
                    sessionId: this.currentSession?.id || null
                };
            }

            if (!this.currentSession || this.currentSession.status !== 'paused') {
                this.logger.warn('No paused session to resume');
                return { resumed: false, reason: 'no_paused_session' };
            }

            const sessionId = this.currentSession.id;
            // Restore run intent
            this.shouldRun = true;
            // Start mining and reinstate timeout management
            await this.startMiningWithTimeout(sessionId);
            this.isRunning = true;
            this.logger.info('Mining session resumed', { sessionId });
            return { resumed: true, sessionId };
        } catch (error) {
            this.logger.error('Failed to resume mining', { error: error.message });
            throw error;
        }
    }

    /**
     * Get session info (current or by id)
     * معلومات الجلسة الحالية أو عبر المعرّف
     */
    getSessionInfo(sessionId) {
        try {
            const session = sessionId ? this.sessions.get(sessionId) : this.currentSession;
            if (!session) return null;
            // Return a safe, serialized view (avoid circular refs)
            const { miner, ...rest } = session;
            return {
                ...rest,
                minerType: miner ? miner.constructor?.name : undefined,
            };
        } catch (e) {
            this.logger.error('Failed to get session info', { error: e.message });
            return null;
        }
    }

    /**
     * List all sessions (safe view)
     * سرد جميع الجلسات
     */
    listSessions() {
        try {
            const arr = [];
            for (const [, session] of this.sessions) {
                const { miner, ...rest } = session;
                arr.push({ ...rest, minerType: miner ? miner.constructor?.name : undefined });
            }
            return arr;
        } catch (e) {
            this.logger.error('Failed to list sessions', { error: e.message });
            return [];
        }
    }

    /**
     * Get current statistics
     * الحصول على الإحصائيات الحالية
     */
    async getStats() {
        const currentStats = {
            ...this.stats,
            isRunning: this.isRunning,
            currentSession: this.currentSession ? {
                id: this.currentSession.id,
                status: this.currentSession.status,
                startTime: this.currentSession.startTime,
                uptime: Date.now() - this.currentSession.startTime
            } : null,
            activeSessions: this.sessions.size,
            performanceHistory: this.performanceHistory.slice(-10) // Last 10 entries
        };

        // Get stats from active miners
        if (this.currentSession && this.currentSession.miner) {
            try {
                const minerStats = await this.currentSession.miner.getStats();
                if (minerStats) {
                    // Ensure we have valid stats
                    currentStats.hashRate = Math.max(0, minerStats.hashRate || 0);
                    // Prefer aggregated session total hashes if available
                    if (this.currentSession.meta && Number.isFinite(this.currentSession.meta.totalHashesAcc)) {
                        // Also perform a delta catch-up in case metrics callback missed updates
                        if (Number.isFinite(minerStats.totalHashes)) {
                            const minerTotal = minerStats.totalHashes >>> 0;
                            const last = this.currentSession.meta.lastMinerTotalHashes;
                            if (typeof last === 'number' && Number.isFinite(last)) {
                                if (minerTotal >= last) {
                                    this.currentSession.meta.totalHashesAcc += (minerTotal - last);
                                }
                                // else: miner restarted; baseline will be updated below
                            }
                            this.currentSession.meta.lastMinerTotalHashes = minerTotal;
                        }
                        currentStats.totalHashes = Math.max(0, this.currentSession.meta.totalHashesAcc >>> 0);
                        // Keep system-wide copy in sync
                        this.stats.totalHashes = currentStats.totalHashes;
                    } else {
                        currentStats.totalHashes = Math.max(0, minerStats.totalHashes || 0);
                    }
                    // Prefer session-aggregated solutions (does not reset with miner restarts)
                    if (this.currentSession.meta && Number.isFinite(this.currentSession.meta.solutionsAcc)) {
                        currentStats.solutions = Math.max(0, this.currentSession.meta.solutionsAcc >>> 0);
                        // Track miner's internal solutions for observability (do not aggregate to avoid double count)
                        if (Number.isFinite(minerStats.solutions)) {
                            this.currentSession.meta.lastMinerSolutions = minerStats.solutions >>> 0;
                        }
                    } else {
                        currentStats.solutions = Math.max(0, minerStats.solutions || 0);
                    }
                    currentStats.startTime = this.currentSession.startTime;
                    // System-level tracking of current nonce for visibility
                    try {
                        this.currentSession.meta = this.currentSession.meta || {};
                        if (Number.isFinite(minerStats.lastNonce)) {
                            this.currentSession.meta.currentNonce = minerStats.lastNonce >>> 0;
                        }
                    } catch {}
                    
                    // Add GPU/CPU breakdown if available
                    if (minerStats.gpuHashRate !== undefined) {
                        currentStats.gpuHashRate = Math.max(0, minerStats.gpuHashRate);
                    } else if (this.gpuMiner && this.gpuMiner.isRunning) {
                        // If GPU miner is running, use total hash rate as GPU hash rate
                        currentStats.gpuHashRate = Math.max(0, minerStats.hashRate || 0);
                    }
                    if (minerStats.cpuHashRate !== undefined) {
                        currentStats.cpuHashRate = Math.max(0, minerStats.cpuHashRate);
                    } else if (this.cpuMiner && this.cpuMiner.isRunning) {
                        // If CPU miner is running, use total hash rate as CPU hash rate
                        currentStats.cpuHashRate = Math.max(0, minerStats.hashRate || 0);
                    }
                    if (minerStats.gpuCapabilities) {
                        currentStats.gpuCapabilities = minerStats.gpuCapabilities;
                    }
                    
                    // Log stats for debugging
                    this.logger.debug('Mining stats updated', {
                        hashRate: currentStats.hashRate,
                        gpuHashRate: currentStats.gpuHashRate,
                        cpuHashRate: currentStats.cpuHashRate,
                        totalHashes: currentStats.totalHashes
                    });
                }
            } catch (error) {
                this.logger.error('Failed to get miner stats', { error: error.message });
            }
        }

        return currentStats;
    }

    /**
     * Update statistics
     * تحديث الإحصائيات
     */
    updateStats(newStats) {
        Object.assign(this.stats, newStats);
        
        // Update performance history
        this.performanceHistory.push({
            timestamp: Date.now(),
            hashRate: this.stats.hashRate,
            totalHashes: this.stats.totalHashes,
            cpuUsage: newStats.cpuUsage || 0,
            memoryUsage: newStats.memoryUsage || 0
        });

        // Keep only last 100 entries
        if (this.performanceHistory.length > 100) {
            this.performanceHistory = this.performanceHistory.slice(-100);
        }

        this.lastUpdate = Date.now();
    }

    /**
     * Handle solution found
     * معالجة الحل الموجود
     */
    async handleSolution(sessionId, solution) {
        try {
            // Log solution received
            this.logger.debug('Solution received for processing', {
                component: 'MiningSystem',
                sessionId: sessionId,
                nonce: solution.nonce,
                hash: solution.hash,
                note: 'Starting solution processing'
            });

            // Create unique solution key
            const solutionKey = `${solution.nonce}-${solution.hash}`;
            
            // Check if solution was already found
            if (this.foundSolutions.has(solutionKey)) {
                this.logger.debug('Duplicate solution ignored', { 
                    nonce: solution.nonce, 
                    hash: solution.hash,
                    sessionId 
                });
                return;
            }
            
            // Check if solution is being processed
            if (this.solutionLock.has(solutionKey)) {
                this.logger.debug('Solution being processed, skipping', { 
                    nonce: solution.nonce, 
                    hash: solution.hash,
                    sessionId 
                });
                return;
            }
            
            // Validate session
            if (!this.sessions.has(sessionId)) {
                this.logger.warn('Invalid session for solution', { 
                    sessionId, 
                    nonce: solution.nonce, 
                    hash: solution.hash 
                });
                return;
            }
            
            // Mark solution as being processed
            this.solutionLock.set(solutionKey, Date.now());
            
            // Add to found solutions to prevent duplicates
            this.foundSolutions.add(solutionKey);
            
            this.stats.solutions++;
            // Increment session-level solutions accumulator (session-scoped, persists across miner restarts)
            try {
                const session = this.sessions.get(sessionId);
                if (session && session.meta) {
                    session.meta.solutionsAcc = (session.meta.solutionsAcc || 0) + 1;
                }
            } catch {}
            
            // this.logger.logSolutionFound(sessionId, solution.nonce, solution.hash);

            // Determine solution type based on difficulty
            const solutionDifficulty = this.calculateSolutionDifficulty(solution.hash);
            const targetDifficulty = this.config.get('mining.blockchain.defaultDifficultyTarget');
            const targetDifficultyLevel = this.calculateTargetDifficultyLevel(targetDifficulty);

            // Save solution
            await this.saveSolution(solution);

            // Broadcast solution (both target and sub-solutions)
            await this.broadcastSolution(solution);

            // Log broadcast confirmation
            this.logger.debug('Solution processed and broadcasted', {
                component: 'MiningSystem',
                sessionId: sessionId,
                nonce: solution.nonce,
                hash: solution.hash,
                difficulty: solutionDifficulty,
                targetLevel: targetDifficultyLevel,
                type: solutionDifficulty >= targetDifficultyLevel ? 'TARGET' : 'SUB_SOLUTION',
                note: 'Solution saved and broadcasted to blockchain'
            });
            
            // Clean up solution lock after processing
            setTimeout(() => {
                this.solutionLock.delete(solutionKey);
            }, 100); // Keep lock for 100ms to prevent race conditions
            
            // Clean up old locks periodically
            const now = Date.now();
            for (const [key, timestamp] of this.solutionLock.entries()) {
                if (now - timestamp > 5000) { // Remove locks older than 5 seconds
                    this.solutionLock.delete(key);
                }
            }

        } catch (error) {
            this.logger.error('Failed to handle solution', { 
                sessionId, 
                solution, 
                error: error.message 
            });
        }
    }

    /**
     * Handle miner-level errors and lifecycle events
     * يعالج أخطاء محرك التعدين على مستوى منخفض
     */
    async handleMinerError(sessionId, err) {
        try {
            const session = this.sessions.get(sessionId);
            if (!session) {
                this.logger.warn('handleMinerError called for unknown session', { sessionId });
                return;
            }

            const type = err && err.type ? err.type : 'unknown_error';
            this.logger.debug('Miner error callback', { sessionId, type, error: err && err.error });

            if (type === 'nonce_exhausted') {
                // Perform nonce rollover at system level and restart miner
                session.meta = session.meta || {};
                session.meta.nonceRollovers = (session.meta.nonceRollovers || 0) + 1;
                session.meta.currentNonce = 0;

                if (session.config) {
                    session.config.timestamp = Math.floor(Date.now() / 1000);
                    session.config.base_nonce = 0;
                }

                this.logger.info('Nonce space exhausted. Performing rollover and restarting miner', { sessionId });

                try {
                    // Only restart if user intends to run and session isn't paused
                    if (this.shouldRun && session.status !== 'paused') {
                        await session.miner.start(session);
                        session.status = 'running';
                        // Track successful system-level restart due to nonce rollover
                        this.stats.restarts++;
                    } else {
                        this.logger.info('Skipping miner restart after nonce rollover due to pause/shouldRun=false', { sessionId });
                    }
                } catch (e) {
                    this.logger.error('Failed to restart miner after nonce rollover', { sessionId, error: e.message });
                }
                return;
            }

            // Other errors: just log; miner may auto-recover based on its own logic
            this.stats.errors++;
            this.logger.warn('Unhandled miner error (no system action taken)', { sessionId, type, err });
        } catch (e) {
            this.logger.error('handleMinerError failed', { sessionId, error: e.message });
        }
    }

    /**
     * Calculate solution difficulty level (number of leading zeros)
     * حساب مستوى صعوبة الحل (عدد الأصفار في البداية)
     */
    calculateSolutionDifficulty(hash) {
        // Convert hash to Buffer (expecting hex string format)
        const hashBuffer = typeof hash === 'string' ? Buffer.from(hash, 'hex') : Buffer.from(hash);
        
        let leadingZeros = 0;
        
        for (let i = 0; i < hashBuffer.length; i++) {
            const byte = hashBuffer[i];
            if (byte === 0) {
                leadingZeros += 8;
            } else {
                // Count leading zeros in this byte
                for (let bit = 7; bit >= 0; bit--) {
                    if ((byte & (1 << bit)) === 0) {
                        leadingZeros++;
                    } else {
                        break;
                    }
                }
                break;
            }
        }
        
        return leadingZeros;
    }

    /**
     * Calculate target difficulty level from target string
     * حساب مستوى الصعوبة المستهدف من سلسلة الهدف
     */
    calculateTargetDifficultyLevel(targetStr) {
        const targetBuffer = Buffer.from(targetStr, 'hex');
        let leadingZeros = 0;
        
        for (let i = 0; i < targetBuffer.length; i++) {
            const byte = targetBuffer[i];
            if (byte === 0) {
                leadingZeros += 8;
            } else {
                // Count leading zeros in this byte
                for (let bit = 7; bit >= 0; bit--) {
                    if ((byte & (1 << bit)) === 0) {
                        leadingZeros++;
                    } else {
                        break;
                    }
                }
                break;
            }
        }
        
        return leadingZeros;
    }

    /**
     * Save solution to file
     * حفظ الحل في ملف
     */
    async saveSolution(solution) {
        try {
            const solutionsPath = this.config.get('storage.paths.solutions');
            await fs.ensureDir(solutionsPath);

            const filename = `solution_${Date.now()}.json`;
            const filepath = path.join(solutionsPath, filename);

            const solutionData = {
                ...solution,
                timestamp: new Date().toISOString(),
                sessionId: this.currentSession?.id
            };

            await fs.writeFile(filepath, JSON.stringify(solutionData, null, 2));
            
            this.logger.debug('Solution saved to file', { 
                component: 'MiningSystem',
                filename, 
                nonce: solution.nonce,
                hash: solution.hash,
                note: 'Solution data saved locally'
            });

        } catch (error) {
            this.logger.error('Failed to save solution', { error: error.message });
        }
    }

    /**
     * Broadcast solution to blockchain
     */
    async broadcastSolution(solution) {
        try {
            // Log broadcast start
            this.logger.debug('Starting solution broadcast', {
                component: 'MiningSystem',
                nonce: solution.nonce,
                hash: solution.hash,
                note: 'Initiating blockchain broadcast'
            });


            // Broadcast to blockchain
            const success = await this.blockchainBroadcaster.broadcastSupportTicket(solution);
            
            if (success) {
                this.logger.debug('Solution broadcasted successfully to blockchain', { 
                    component: 'MiningSystem',
                    nonce: solution.nonce,
                    hash: solution.hash,
                    note: 'Blockchain broadcast completed successfully'
                });
            } else {
                this.logger.error('Failed to broadcast solution to blockchain', { 
                    component: 'MiningSystem',
                    nonce: solution.nonce,
                    hash: solution.hash,
                    note: 'Blockchain broadcast failed'
                });
            }

        } catch (error) {
            this.logger.error('Failed to broadcast solution', { 
                error: error.message,
                nonce: solution.nonce,
                hash: solution.hash
            });
        }
    }

    /**
     * Restart mining
     * إعادة بدء التعدين
     */
    async restartMining() {
        try {
            // Respect user intent and paused state
            if (!this.shouldRun || (this.currentSession && this.currentSession.status === 'paused')) {
                this.logger.info('Restart mining aborted: system is paused or shouldRun=false');
                return;
            }

            this.stats.restarts++;
            this.logger.info('Restarting mining...');

            // Stop current mining
            const prevIntent = this.shouldRun;
            await this.stop();
            // Restore run intent for controlled restart
            this.shouldRun = prevIntent;

            // Wait for restart delay
            const delay = this.config.get('mining.restart.delaySeconds') * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));

            // Start mining again only if still intended to run
            if (this.shouldRun) {
                await this.start();
            } else {
                this.logger.info('Restart aborted after delay: shouldRun=false');
            }

            this.logger.info('Mining restarted successfully');

        } catch (error) {
            this.logger.error('Failed to restart mining', { error: error.message });
            throw error;
        }
    }

    /**
     * Start mining session with timeout management
     * بدء جلسة التعدين مع إدارة المهلة
     */
    async startMiningWithTimeout(sessionId) {
    try {
        // Abort if not intended to run (e.g., paused) to prevent race starts
        if (!this.shouldRun) {
            this.logger.warn('startMiningWithTimeout aborted: shouldRun=false', { sessionId });
            return;
        }

        const timeout = this.config.get('mining.session.timeout', 3600) * 1000; // Convert to milliseconds
        
        this.logger.debug('Starting mining session with timeout', {
            sessionId,
            timeoutSeconds: timeout / 1000
        });

        // Start mining
        await this.startMining(sessionId);

        // Set timeout to restart mining after session ends
        // Clear any prior timeout for this session before setting a new one
        const existing = this.sessionTimeouts.get(sessionId);
        if (existing) {
            clearTimeout(existing);
            this.sessionTimeouts.delete(sessionId);
        }

        const handle = setTimeout(async () => {
            // If paused or not intended to run, do nothing
            if (!this.shouldRun || (this.currentSession && this.currentSession.status === 'paused')) {
                this.logger.info('Session timeout fired but system is paused or shouldRun=false; ignoring', { sessionId });
                this.sessionTimeouts.delete(sessionId);
                return;
            }

            this.logger.info('Mining session timeout reached, restarting...', { sessionId });
            
            // Only restart if auto-restart is enabled
            if (this.config.get('mining.restart.autoRestart')) {
                await this.restartMining();
            } else {
                this.logger.info('Auto-restart disabled, stopping mining', { sessionId });
                await this.stop();
            }
            // Cleanup timeout handle after it fires
            this.sessionTimeouts.delete(sessionId);
        }, timeout);

        this.sessionTimeouts.set(sessionId, handle);

    } catch (error) {
        this.logger.error('Failed to start mining with timeout', { 
            sessionId, 
            error: error.message 
        });
        throw error;
    }
}



    /**
     * Setup event handlers
     * إعداد معالجات الأحداث
     */
    setupEventHandlers() {
        // Handle solution events from miners
        this.on('solution', async (data) => {
            await this.handleSolution(data.sessionId, data.solution);
        });

        // Handle error events
        this.on('error', (error) => {
            this.stats.errors++;
            this.logger.logError(error, { component: 'MiningSystem' });
        });

        // Handle performance events
        this.on('performance', (data) => {
            this.updateStats(data);
        });
    }

    /**
     * Event emitter methods
     * طرق بث الأحداث
     */
    on(event, handler) {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }
        this.eventHandlers.get(event).push(handler);
    }

    emit(event, data) {
        const handlers = this.eventHandlers.get(event);
        if (handlers) {
            handlers.forEach(handler => {
                try {
                    handler(data);
                } catch (error) {
                    this.logger.error('Event handler error', { event, error: error.message });
                }
            });
        }
    }

    /**
     * Save system state
     * حفظ حالة النظام
     */
    async saveState() {
        try {
            const statePath = this.config.get('storage.paths.state');
            await fs.ensureDir(statePath);

            // Sanitize sessions to avoid circular references (e.g., session.miner -> currentSession)
            const sessionsSafe = Array.from(this.sessions.entries()).map(([id, s]) => [
                id,
                {
                    id: s.id,
                    status: s.status,
                    startTime: s.startTime,
                    uptime: s.uptime,
                    // Persist config snapshot if present (non-circular)
                    config: s.config,
                }
            ]);

            const state = {
                stats: this.stats,
                sessions: sessionsSafe,
                timestamp: Date.now()
            };

            const stateFile = path.join(statePath, 'mining_state.json');
            await fs.writeFile(stateFile, JSON.stringify(state, null, 2));

            this.logger.debug('System state saved');

        } catch (error) {
            this.logger.error('Failed to save system state', { error: error.message });
        }
    }

    /**
     * Load system state
     * تحميل حالة النظام
     */
    async loadState() {
        try {
            const statePath = this.config.get('storage.paths.state');
            const stateFile = path.join(statePath, 'mining_state.json');

            if (await fs.pathExists(stateFile)) {
                const stateData = await fs.readFile(stateFile, 'utf8');
                const state = JSON.parse(stateData);

                // Restore stats
                if (state.stats) {
                    this.stats = { ...this.stats, ...state.stats };
                }

                // Restore sessions
                if (state.sessions) {
                    this.sessions = new Map(state.sessions);
                }

                this.logger.info('✅ System state loaded successfully');

            } else {
                this.logger.debug('No previous state found');
            }

        } catch (error) {
            this.logger.warn('Failed to load system state', { error: error.message });
        }
    }

    /**
     * Get system health
     * الحصول على صحة النظام
     */
    async getHealth() {
        const health = {
            status: this.isRunning ? 'healthy' : 'stopped',
            uptime: Date.now() - this.stats.startTime,
            errors: this.stats.errors,
            restarts: this.stats.restarts,
            activeSessions: this.sessions.size
        };

        // Check miner health
        if (this.currentSession && this.currentSession.miner) {
            const minerHealth = await this.currentSession.miner.getHealth();
            Object.assign(health, minerHealth);
        }

        return health;
    }

    /**
     * Cleanup resources
     * تنظيف الموارد
     */
    async cleanup() {
        try {
            this.logger.info('Cleaning up mining system...');

            // Stop all miners
            if (this.gpuMiner) await this.gpuMiner.cleanup();
            if (this.cpuMiner) await this.cpuMiner.cleanup();
    

            // Save state
            await this.saveState();

            this.logger.info('Mining system cleanup completed');

        } catch (error) {
            this.logger.error('Failed to cleanup mining system', { error: error.message });
        }
    }
}

module.exports = MiningSystem; 