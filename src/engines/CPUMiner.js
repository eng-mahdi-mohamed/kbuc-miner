/**
 * CPU Mining Engine with Parallel Processing
 */

const { Worker } = require('worker_threads');
const path = require('path');
const os = require('os');
const { doubleSHA256 } = require('../utils/hashingUtils');

class CPUMiner {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger.child({ component: 'CPUMiner' });
        
        this.isInitialized = false;
        this.isRunning = false;
        this.workers = [];
        this.currentSession = null;
        this.workerStats = new Map();
        this.workerLastNonce = new Map();
        
        this.stats = {
            hashRate: 0,
            totalHashes: 0,
            solutions: 0,
            startTime: 0,
            lastUpdate: 0,
            lastNonce: 0,
        };
        
        // CPU capabilities
        this.cpuCapabilities = {
            cores: os.cpus().length,
            architecture: os.arch(),
            platform: os.platform(),
            totalMemory: os.totalmem()
        };
        
        // Performance tracking
        this.performanceHistory = [];
        this.lastHashCount = 0;
        this.lastHashTime = Date.now();
        
        // Solution deduplication
        this.foundSolutions = new Set();

        // Optional callbacks for integration with MiningSystem
        this.onMetrics = null;
        this.onError = null;
    }

    /**
     * Initialize CPU miner
     * تهيئة محرك CPU
     */
    async initialize() {
        try {
            this.logger.info('Initializing CPU miner...');

            // Detect CPU capabilities
            await this.detectCPUCapabilities();

            // Initialize SHA-256 implementation
            await this.initializeSHA256();

            this.isInitialized = true;
            this.logger.info('✅ CPU miner initialized successfully', {
                capabilities: this.cpuCapabilities
            });

        } catch (error) {
            this.logger.error('Failed to initialize CPU miner', { error: error.message });
            throw error;
        }
    }

    /**
     * Detect CPU capabilities
     * اكتشاف قدرات CPU
     */
    async detectCPUCapabilities() {
        try {
            const cpus = os.cpus();
            
            this.cpuCapabilities = {
                cores: cpus.length,
                architecture: os.arch(),
                platform: os.platform(),
                totalMemory: os.totalmem(),
                cpuModel: cpus[0]?.model || 'Unknown',
                cpuSpeed: cpus[0]?.speed || 0
            };
        } catch (error) {
            this.logger.warn('Failed to detect CPU capabilities', { error: error.message });
        }
    }

    /**
     * Initialize SHA-256 implementation
     * تهيئة تنفيذ SHA-256
     */
    async initializeSHA256() {
        try {
            // Test SHA-256 performance
            const testData = Buffer.from('test');
            const startTime = Date.now();
            
            for (let i = 0; i < 10000; i++) {
                // Use unified doubleSHA256 to mirror mining path
                doubleSHA256(testData);
            }
            
            const endTime = Date.now();
            const duration = endTime - startTime;
            const hashesPerSecond = 10000 / (duration / 1000);

            this.logger.info('SHA-256 performance test completed', {
                hashesPerSecond: Math.round(hashesPerSecond),
                duration: duration
            });

        } catch (error) {
            this.logger.error('Failed to initialize SHA-256', { error: error.message });
            throw error;
        }
    }

    /**
     * Start CPU mining
     * بدء التعدين على CPU
     */
    async start(session) {
        try {
            if (!this.isInitialized) {
                throw new Error('CPU miner not initialized');
            }

            this.logger.info('Starting CPU mining', { sessionId: session.id });

            this.currentSession = session;
            this.isRunning = true;
            this.stats.startTime = Date.now();
            this.stats.lastUpdate = Date.now();

            // Start CPU mining workers
            await this.startCPUWorkers(session);

            // Start performance monitoring
            this.startPerformanceMonitoring();

            this.logger.info('CPU mining started successfully');

        } catch (error) {
            this.logger.error('Failed to start CPU mining', { error: error.message });
            throw error;
        }
    }

    /**
     * Start CPU mining workers
     * بدء عمال CPU
     */
    async startCPUWorkers(session) {
        const maxWorkers = Math.min(
            this.config.get('performance.workers.maxCount'),
            this.cpuCapabilities.cores
        );
        const batchSize = this.config.get('engines.cpu.batchSize');

        this.logger.info('Starting CPU workers', { 
            maxWorkers, 
            cores: this.cpuCapabilities.cores,
            batchSize 
        });

        // Create CPU workers
        for (let i = 0; i < maxWorkers; i++) {
            const worker = new Worker(path.join(__dirname, '../workers/CPUWorker.js'), {
                workerData: {
                    workerId: i,
                    sessionId: session.id,
                    config: {
                        ticket_data: session.config.ticket_data,
                        leader_address: session.config.leader_address,
                        reward_address: session.config.reward_address,
                        block_height: session.config.block_height,
                        mining_type: session.config.mining_type,
                        timestamp: session.config.timestamp,
                        difficulty_target: session.config.difficulty_target,
                        timeLimit: session.config.timeLimit,
                        base_nonce: session.config.base_nonce >>> 0,
                    },
                    baseNonce: session.config.base_nonce >>> 0,
                    batchSize: batchSize,
                    cpuCapabilities: this.cpuCapabilities
                }
            });

            worker.on('message', (data) => {
                this.handleWorkerMessage(data);
            });

            worker.on('error', (error) => {
                this.logger.error('CPU worker error', { workerId: i, error: error.message });
                if (typeof this.onError === 'function') {
                    try { this.onError({ type: 'worker_error', workerId: i, error: error.message }); } catch {}
                }
            });

            worker.on('exit', (code) => {
                if (code !== 0) {
                    this.logger.warn('CPU worker exited with code', { workerId: i, code });
                    if (typeof this.onError === 'function') {
                        try { this.onError({ type: 'worker_exit', workerId: i, code }); } catch {}
                    }
                }
            });

            this.workers.push(worker);
        }

        this.logger.info('CPU workers started', { 
            count: this.workers.length,
            workDistribution: `Each worker starts ${1000000} nonces apart`
        });
    }

    /**
     * Handle messages from CPU workers
     * معالجة الرسائل من عمال CPU
     */
    handleWorkerMessage(data) {
        // Validate data
        if (!data || typeof data !== 'object') {
            this.logger.warn('Invalid worker message received', { data });
            return;
        }
        
        switch (data.type) {
            case 'stats':
                this.updateStats(data.data || data.stats);
                // Track worker last nonce if provided
                {
                    const payload = data.data || data.stats || {};
                    const wid = payload.workerId ?? data.workerId;
                    if (wid !== undefined && payload.lastNonce !== undefined) {
                        this.workerLastNonce.set(wid, payload.lastNonce >>> 0);
                        // Aggregate max last nonce across workers
                        let maxLast = 0;
                        for (const v of this.workerLastNonce.values()) { if (v > maxLast) maxLast = v; }
                        this.stats.lastNonce = maxLast >>> 0;
                        // Emit metrics callback to system for real-time tracking
                        if (typeof this.onMetrics === 'function' && this.currentSession) {
                            try {
                                this.onMetrics(this.currentSession.id, {
                                    rate: this.stats.hashRate,
                                    totalHashes: this.stats.totalHashes,
                                    solutions: this.stats.solutions,
                                    lastNonce: this.stats.lastNonce,
                                });
                            } catch {}
                        }
                    }
                }
                break;
            
            case 'solution':
                let solutionData = null;
                
                if (data.data && typeof data.data === 'object' && data.data.nonce && data.data.hash) {
                    solutionData = data.data;
                } else if (data.solution && typeof data.solution === 'object' && data.solution.nonce && data.solution.hash) {
                    solutionData = data.solution;
                } else {
                    this.logger.warn('Solution message received but no valid solution data', { 
                        data,
                        hasData: !!data.data,
                        hasSolution: !!data.solution,
                        dataType: typeof data.data,
                        solutionType: typeof data.solution
                    });
                    return;
                }
                
                this.handleSolution(solutionData);
                break;
            
            case 'error':
                this.logger.error('CPU worker error', { error: data.error });
                if (typeof this.onError === 'function') {
                    try { this.onError({ type: 'worker_reported_error', workerId: data.workerId, error: data.error }); } catch {}
                }
                break;
            
            case 'started':
                break;
            
            case 'info':
                this.logger.debug('CPU worker info', { info: data.data, workerId: data.workerId });
                break;
            
            case 'performance':
                this.updatePerformance(data.performance);
                break;
            
            default:
                this.logger.debug('Unknown CPU worker message', { type: data.type });
        }
    }

    /**
     * Update statistics
     * تحديث الإحصائيات
     */
    updateStats(newStats) {
        // Validate newStats
        if (!newStats || typeof newStats !== 'object') {
            this.logger.debug('Invalid stats received', { newStats });
            return;
        }

        // Maintain per-worker stats and aggregate
        const workerId = newStats.workerId;
        if (workerId !== undefined && workerId !== null) {
            this.workerStats.set(workerId, {
                hashRate: Math.max(0, newStats.hashRate || 0),
                totalHashes: Math.max(0, newStats.totalHashes || 0),
                lastNonce: Number.isFinite(newStats.lastNonce) ? (newStats.lastNonce >>> 0) : undefined,
            });
        }

        // Aggregate hashRate and totalHashes across workers
        let aggHashRate = 0;
        let aggTotalHashes = 0;
        let maxLastNonce = 0;
        for (const s of this.workerStats.values()) {
            aggHashRate += s.hashRate || 0;
            aggTotalHashes += s.totalHashes || 0;
            if (Number.isFinite(s.lastNonce)) {
                if (s.lastNonce > maxLastNonce) maxLastNonce = s.lastNonce >>> 0;
            }
        }

        const previousHashRate = this.stats.hashRate;
        const previousTotalHashes = this.stats.totalHashes;

        this.stats.hashRate = aggHashRate;
        this.stats.totalHashes = aggTotalHashes;
        this.stats.lastNonce = maxLastNonce >>> 0;
        this.stats.lastUpdate = Date.now();

        // Minimal periodic debug to avoid spam
        const now = Date.now();
        const shouldLog =
            this.stats.hashRate !== previousHashRate ||
            (now - (this.lastStatsLog || 0)) > 10000;
        if (shouldLog) {
            this.lastStatsLog = now;
        }
    }

    /**
     * Update performance metrics
     * تحديث مقاييس الأداء
     */
    updatePerformance(performance) {
        this.performanceHistory.push({
            timestamp: Date.now(),
            ...performance
        });

        // Keep only last 100 entries
        if (this.performanceHistory.length > 100) {
            this.performanceHistory = this.performanceHistory.slice(-100);
        }

        // Calculate hash rate
        const now = Date.now();
        const timeDiff = (now - this.lastHashTime) / 1000;
        const hashDiff = this.stats.totalHashes - this.lastHashCount;
        
        if (timeDiff > 0) {
            this.stats.hashRate = hashDiff / timeDiff;
        }

        this.lastHashCount = this.stats.totalHashes;
        this.lastHashTime = now;
    }

    /**
     * Handle solution found
     * معالجة الحل الموجود
     */
    handleSolution(solution) {
        // Validate solution object
        if (!solution || typeof solution !== 'object') {
            this.logger.warn('Invalid solution received', { solution });
            return;
        }

        // Ensure required properties exist
        if (!solution.nonce || !solution.hash) {
            this.logger.warn('Solution missing required properties', { 
                hasNonce: !!solution.nonce, 
                hasHash: !!solution.hash,
                solution 
            });
            return;
        }

        // Check for duplicate solutions
        const solutionKey = `${solution.nonce}-${solution.hash}`;
        if (this.foundSolutions.has(solutionKey)) {
            this.logger.debug('Duplicate solution ignored by CPUMiner', { 
                nonce: solution.nonce, 
                hash: solution.hash 
            });
            return;
        }

        // Add to found solutions
        this.foundSolutions.add(solutionKey);
        this.stats.solutions++;
        
        // Emit solution event but don't stop mining
        if (this.onSolution) {
            this.onSolution(this.currentSession?.id, solution);
        }

        // Log single comprehensive solution message
        this.logger.info('Solution found!', {
            component: 'CPUMiner',
            sessionId: this.currentSession?.id,
            source: 'cpu',
            nonce: solution.nonce,
            hash: solution.hash,
            note: 'Continuing mining for additional solutions'
        });
    }

    /**
     * Start performance monitoring
     * بدء مراقبة الأداء
     */
    startPerformanceMonitoring() {
        this._perfTick = 0;
        this.performanceInterval = setInterval(() => {
            if (this.isRunning) {
                this.updatePerformanceMetrics();
                // Periodically attempt performance optimization
                if ((this._perfTick++ % 2) === 0) { // ~ every 10s
                    this.optimizePerformance().catch(() => {});
                }
            }
        }, 5000); // Update every 5 seconds
    }

    /**
     * Update performance metrics
     * تحديث مقاييس الأداء
     */
    updatePerformanceMetrics() {
        const now = Date.now();
        const uptime = now - this.stats.startTime;
        
        // Calculate average hash rate
        if (uptime > 0) {
            const avgHashRate = this.stats.totalHashes / (uptime / 1000);
            
            this.performanceHistory.push({
                timestamp: now,
                hashRate: this.stats.hashRate,
                avgHashRate: avgHashRate,
                totalHashes: this.stats.totalHashes,
                solutions: this.stats.solutions,
                uptime: uptime
            });
        }
    }

    /**
     * Stop CPU mining
     * إيقاف التعدين على CPU
     */
    async stop() {
        try {
            this.logger.info('Stopping CPU mining...');

            this.isRunning = false;

            // Stop performance monitoring
            if (this.performanceInterval) {
                clearInterval(this.performanceInterval);
                this.performanceInterval = null;
            }

            // Stop all workers
            await Promise.all(this.workers.map(w => {
                try { return w.terminate(); } catch { return Promise.resolve(); }
            }));
            this.workers = [];
            this.workerStats.clear();

            this.currentSession = null;

            this.logger.info('CPU mining stopped successfully');

        } catch (error) {
            this.logger.error('Failed to stop CPU mining', { error: error.message });
            throw error;
        }
    }

    /**
     * Get CPU mining statistics
     * الحصول على إحصائيات CPU
     */
    async getStats() {
        return {
            ...this.stats,
            isRunning: this.isRunning,
            workers: this.workers.length,
            cpuCapabilities: this.cpuCapabilities,
            performanceHistory: this.performanceHistory.slice(-10), // Last 10 entries
            cpuHashRate: this.stats.hashRate, // Add CPU hash rate
            lastNonce: this.stats.lastNonce >>> 0,
        };
    }

    /**
     * Get CPU health status
     * الحصول على حالة صحة CPU
     */
    async getHealth() {
        const cpuUsage = await this.getCPUUsage();
        
        return {
            status: this.isRunning ? 'healthy' : 'stopped',
            workers: this.workers.length,
            uptime: Date.now() - this.stats.startTime,
            hashRate: this.stats.hashRate,
            solutions: this.stats.solutions,
            cpuUsage: cpuUsage
        };
    }

    /**
     * Get current CPU usage
     * الحصول على استخدام CPU الحالي
     */
    async getCPUUsage() {
        try {
            const cpus = os.cpus();
            let totalIdle = 0;
            let totalTick = 0;

            cpus.forEach(cpu => {
                for (let type in cpu.times) {
                    totalTick += cpu.times[type];
                }
                totalIdle += cpu.times.idle;
            });

            const idle = totalIdle / cpus.length;
            const total = totalTick / cpus.length;
            const usage = 100 - (idle / total * 100);

            return Math.round(usage * 100) / 100;
        } catch (error) {
            this.logger.error('Failed to get CPU usage', { error: error.message });
            return 0;
        }
    }

    /**
     * Optimize CPU mining based on system resources
     * تحسين التعدين على CPU بناءً على موارد النظام
     */
    async optimizePerformance() {
        try {
            const cpuUsage = await this.getCPUUsage();
            const memoryUsage = (os.totalmem() - os.freemem()) / os.totalmem() * 100;

            // Adjust worker count based on system load
            const currentWorkers = this.workers.length;
            const maxWorkers = this.config.get('performance.workers.maxCount');
            const cpuThreshold = this.config.get('performance.thresholds.cpu');
            const memoryThreshold = this.config.get('performance.thresholds.memory');

            let newWorkerCount = currentWorkers;

            if (cpuUsage > cpuThreshold || memoryUsage > memoryThreshold) {
                // Reduce workers if system is overloaded
                newWorkerCount = Math.max(1, Math.floor(currentWorkers * 0.8));
                this.logger.warn('System overloaded, reducing workers', {
                    cpuUsage,
                    memoryUsage,
                    currentWorkers,
                    newWorkerCount
                });
            } else if (cpuUsage < cpuThreshold * 0.7 && memoryUsage < memoryThreshold * 0.7) {
                // Increase workers if system has capacity
                newWorkerCount = Math.min(maxWorkers, Math.floor(currentWorkers * 1.2));
                this.logger.info('System has capacity, increasing workers', {
                    cpuUsage,
                    memoryUsage,
                    currentWorkers,
                    newWorkerCount
                });
            }

            if (newWorkerCount !== currentWorkers) {
                await this.adjustWorkers(newWorkerCount);
            }

        } catch (error) {
            this.logger.error('Failed to optimize performance', { error: error.message });
        }
    }

    /**
     * Adjust number of workers
     * تعديل عدد العمال
     */
    async adjustWorkers(newCount) {
        try {
            const currentCount = this.workers.length;

            if (newCount > currentCount) {
                // Add workers
                const session = this.currentSession;
                const batchSize = this.config.get('engines.cpu.batchSize');

                for (let i = currentCount; i < newCount; i++) {
                    const worker = new Worker(path.join(__dirname, '../workers/CPUWorker.js'), {
                        workerData: {
                            workerId: i,
                            sessionId: session?.id,
                            config: session ? {
                                ticket_data: session.config.ticket_data,
                                leader_address: session.config.leader_address,
                                reward_address: session.config.reward_address,
                                block_height: session.config.block_height,
                                mining_type: session.config.mining_type,
                                timestamp: session.config.timestamp,
                                difficulty_target: session.config.difficulty_target,
                                timeLimit: session.config.timeLimit,
                                base_nonce: session.config.base_nonce >>> 0,
                            } : undefined,
                            baseNonce: session ? (session.config.base_nonce >>> 0) : 0,
                            batchSize: batchSize,
                            cpuCapabilities: this.cpuCapabilities
                        }
                    });

                    worker.on('message', (data) => {
                        this.handleWorkerMessage(data);
                    });

                    worker.on('error', (error) => {
                        this.logger.error('CPU worker error', { workerId: i, error: error.message });
                    });

                    this.workers.push(worker);
                }

                this.logger.info('Added CPU workers', { added: newCount - currentCount });

            } else if (newCount < currentCount) {
                // Remove workers
                const workersToRemove = this.workers.slice(newCount);
                this.workers = this.workers.slice(0, newCount);

                for (const worker of workersToRemove) {
                    try { await worker.terminate(); } catch {}
                }

                this.logger.info('Removed CPU workers', { removed: currentCount - newCount });
            }

        } catch (error) {
            this.logger.error('Failed to adjust workers', { error: error.message });
        }
    }

    /**
     * Cleanup CPU resources
     * تنظيف موارد CPU
     */
    async cleanup() {
        try {
            this.logger.info('Cleaning up CPU miner...');

            // Stop mining if running
            if (this.isRunning) {
                await this.stop();
            }

            // Clear performance history
            this.performanceHistory = [];

            this.isInitialized = false;

            this.logger.info('CPU miner cleanup completed');

        } catch (error) {
            this.logger.error('Failed to cleanup CPU miner', { error: error.message });
        }
    }

    /**
     * Set solution callback
     * تعيين callback للحل
     */
    setSolutionCallback(callback) {
        this.onSolution = callback;
    }

    /**
     * Set metrics callback for real-time stats
     */
    setMetricsCallback(callback) {
        this.onMetrics = callback;
    }

    /**
     * Set error callback for miner-level errors
     */
    setErrorCallback(callback) {
        this.onError = callback;
    }
}

module.exports = CPUMiner; 