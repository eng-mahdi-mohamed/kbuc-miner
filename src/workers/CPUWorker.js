/**
 * CPU Worker for Mining
 * CPU Worker for Mining
 */

const { parentPort, workerData } = require('worker_threads');
const { buildHeaderPrefix, buildHeaderWithNonce, doubleSHA256, isHashBelowTarget } = require('../utils/hashingUtils');

class CPUWorker {
    constructor(data) {
        this.workerId = data.workerId;
        this.sessionId = data.sessionId;
        this.config = data.config;
        this.batchSize = data.batchSize;
        // Support resuming from a base nonce provided by the session
        this.baseNonce = ((data.baseNonce !== undefined ? data.baseNonce : (data.config && data.config.base_nonce)) || 0) >>> 0;
        
        this.isRunning = false;
        this.stats = {
            hashRate: 0,
            totalHashes: 0,
            solutions: 0,
            startTime: Date.now(),
            lastUpdate: Date.now(),
            lastNonce: 0,
        };
        
        // Mining state
        this.currentNonce = 0;
        this.targetHex = this.config.difficulty_target;
        this.headerPrefix = buildHeaderPrefix(this.config);
        
        // Performance tracking
        this.hashCount = 0;
        this.lastHashTime = Date.now();
        this.updateInterval = 1000; // 1 second
        
        // Work distribution - each worker gets a different starting nonce
        // Use a larger offset to ensure workers don't overlap
        this.workStride = 1000000;
        this.workOffset = (this.baseNonce >>> 0) + (this.workerId * this.workStride); // Each worker starts 1M nonces apart from base
        this.currentNonce = this.workOffset;
        
        // Solution tracking to prevent duplicates within worker
        // this.foundSolutions = new Set();
        
        // Initialize logger for worker
        this.logger = {
            info: (message, data) => {
                console.log(`[INFO] ${message}`, data || '');
            },
            debug: (message, data) => {
                console.log(`[DEBUG] ${message}`, data || '');
            },
            error: (message, data) => {
                console.error(`[ERROR] ${message}`, data || '');
            },
            warn: (message, data) => {
                console.warn(`[WARN] ${message}`, data || '');
            }
        };
    }

    /**
     * Parse target hash string
     * تحليل سلسلة الهدف
     */
    parseTarget(targetStr) {
        return Buffer.from(targetStr, 'hex');
    }

    /**
     * Start mining
     * بدء التعدين
     */
    start() {
        try {
            this.isRunning = true;
            this.currentNonce = this.workOffset; // Use the pre-calculated work offset
            
            // Log worker start information
            // this.logger.info(`CPU Worker ${this.workerId} starting with nonce range`, {
            //     workerId: this.workerId,
            //     startNonce: this.currentNonce,
            //     workOffset: this.workOffset,
            //     batchSize: this.batchSize
            // });
            
            // Start performance monitoring
            this.startPerformanceMonitoring();
            
            // Start mining loop
            this.mine();
            
            this.sendMessage('started', {
                workerId: this.workerId,
                startTime: this.stats.startTime,
                startNonce: this.currentNonce
            });
        } catch (error) {
            this.sendMessage('error', {
                workerId: this.workerId,
                error: error.message,
                type: 'start_error'
            });
            this.stop();
        }
    }

    /**
     * Main mining loop
     * حلقة التعدين الرئيسية
     */
    mine() {
        if (!this.isRunning) return;

        const startTime = Date.now();
        let hashesThisBatch = 0;
        let solutionsFound = 0;

        // Process a batch of nonces with optimized hashing
        for (let i = 0; i < this.batchSize && this.isRunning; i++) {
            const nonce = this.currentNonce + i;
            
            // Build header with nonce using unified util
            const headerWithNonce = buildHeaderWithNonce(this.headerPrefix, nonce);
            
            // Calculate double SHA-256 hash using unified util
            const finalHashBE = doubleSHA256(headerWithNonce);
            // Hex string for reporting
            const hash = finalHashBE.toString('hex');
            
            hashesThisBatch++;
            
            // Check if hash is less than target
            if (isHashBelowTarget(finalHashBE, this.targetHex)) {
                const wasNewSolution = this.handleSolution(nonce, hash, headerWithNonce.toString("hex"));
                if (wasNewSolution) {
                    solutionsFound++;
                }
                // Continue searching for more solutions in this batch
                // Don't break - continue with next nonce
            }
        }

        // Update statistics
        this.updateStats(hashesThisBatch, startTime);
        
        // Send stats message
        if (hashesThisBatch > 0) {
            this.sendMessage('stats', {
                hashRate: this.stats.hashRate,
                totalHashes: this.stats.totalHashes,
                solutions: this.stats.solutions,
                workerId: this.workerId,
                lastNonce: (this.currentNonce + this.batchSize - 1) >>> 0,
            });
        }
        
        // Continue mining if still running
        if (this.isRunning) {
            this.currentNonce += this.batchSize;
            setImmediate(() => this.mine());
        }
    }

    /**
     * Check if hash is less than target
     * التحقق من أن الـ hash أقل من الهدف
     */
    isHashLessThanTarget(hash, target) {
        // Wrapper to keep compatibility, delegates to unified util
        const hashBE = typeof hash === 'string' ? Buffer.from(hash, 'hex') : hash;
        const targetHex = typeof target === 'string' ? target : Buffer.from(target).toString('hex');
        return isHashBelowTarget(hashBE, targetHex);
    }

    /**
     * Handle solution found
     * معالجة الحل الموجود
     */
    handleSolution(nonce, hash, header) {
        // Create unique solution key for this worker
        const solutionKey = `${nonce}-${hash}`;
        
        // Avoid duplicate solutions in this worker instance
        if (this.foundSolutions && this.foundSolutions.has(solutionKey)) {
            return false;
        }
        
        // // Add to found solutions for this worker
        // this.foundSolutions.add(solutionKey);
        
        this.stats.solutions++;
        
        const solution = {
            nonce: nonce.toString(16).padStart(8, '0'),
            hash: typeof hash === 'string' ? hash : hash.toString('hex'),
            workerId: this.workerId,
            header,
        };

        this.sendMessage('solution', solution);
        
        // Continue mining for more solutions instead of stopping
        this.sendMessage('info', {
            workerId: this.workerId,
            message: 'Solution found, continuing CPU mining for additional solutions...',
            nonce: solution.nonce,
            hash: solution.hash
        });
        
        return true; // Return true for new solution
    }

    /**
     * Update statistics
     * تحديث الإحصائيات
     */
    updateStats(hashesThisBatch, startTime) {
        this.hashCount += hashesThisBatch;
        this.stats.totalHashes += hashesThisBatch;
        
        const now = Date.now();
        const timeDiff = (now - this.lastHashTime) / 1000;
        
        // Calculate hash rate more accurately
        if (timeDiff > 0) {
            // Calculate hash rate for this batch
            const batchHashRate = hashesThisBatch / timeDiff;
            
            // Ensure hash rate is non-negative
            const safeBatchHashRate = Math.max(0, batchHashRate);
            
            // Use exponential moving average for smoother hash rate
            const alpha = 0.3; // Smoothing factor
            if (this.stats.hashRate === 0) {
                this.stats.hashRate = safeBatchHashRate;
            } else {
                this.stats.hashRate = Math.max(0, (alpha * safeBatchHashRate) + ((1 - alpha) * this.stats.hashRate));
            }
        }
        
        // Send stats update every 2 seconds to reduce spam
        if (timeDiff >= 2.0) {
            this.stats.lastUpdate = now;
            
            // Only send stats if hash rate is significant or solutions found
            if (this.stats.hashRate > 0 || this.stats.solutions > 0) {
                this.sendMessage('stats', {
                    hashRate: this.stats.hashRate,
                    totalHashes: this.stats.totalHashes,
                    solutions: this.stats.solutions,
                    workerId: this.workerId,
                    lastNonce: Math.max(0, (this.currentNonce - 1) >>> 0),
                });
            }
            
            // Reset counters
            this.hashCount = 0;
            this.lastHashTime = now;
        }
    }

    /**
     * Start performance monitoring
     * بدء مراقبة الأداء
     */
    startPerformanceMonitoring() {
        this.performanceInterval = setInterval(() => {
            if (this.isRunning) {
                this.sendMessage('performance', {
                    workerId: this.workerId,
                    hashRate: this.stats.hashRate,
                    totalHashes: this.stats.totalHashes,
                    uptime: Date.now() - this.stats.startTime
                });
            }
        }, this.updateInterval);
    }

    /**
     * Stop mining
     * إيقاف التعدين
     */
    stop() {
        try {
            this.isRunning = false;
            
            if (this.performanceInterval) {
                clearInterval(this.performanceInterval);
                this.performanceInterval = null;
            }
            
            this.sendMessage('stopped', {
                workerId: this.workerId,
                finalStats: this.stats
            });
        } catch (error) {
            // Log error but don't throw to prevent unhandled rejection
            console.error(`CPU Worker ${this.workerId}: Failed to stop`, error);
        }
    }

    /**
     * Send message to parent
     * إرسال رسالة للوالد
     */
    sendMessage(type, data) {
        try {
            if (parentPort) {
                parentPort.postMessage({
                    type: type,
                    data: data,
                    workerId: this.workerId
                });
            }
        } catch (error) {
            // Log error but don't throw to prevent unhandled rejection
            console.error(`CPU Worker ${this.workerId}: Failed to send message`, error);
        }
    }

    /**
     * Handle messages from parent
     * معالجة الرسائل من الوالد
     */
    handleMessage(message) {
        switch (message.type) {
            case 'start':
                this.start();
                break;
                
            case 'stop':
                this.stop();
                break;
                
            case 'update_config':
                this.updateConfig(message.config);
                break;
                
            default:
                this.sendMessage('info', {
                    workerId: this.workerId,
                    message: `Unknown message type: ${message.type}`
                });
        }
    }

    /**
     * Update mining configuration
     * تحديث تكوين التعدين
     */
    updateConfig(newConfig) {
        try {
            if (newConfig && typeof newConfig === 'object') {
                // Merge config updates and rebuild header prefix
                this.config = { ...this.config, ...newConfig };
                this.headerPrefix = buildHeaderPrefix(this.config);
            }

            if (newConfig && (newConfig.difficulty_target || newConfig.target)) {
                this.targetHex = newConfig.difficulty_target || newConfig.target;
            }

            if (newConfig && newConfig.batchSize) {
                this.batchSize = newConfig.batchSize;
            }

            this.sendMessage('config_updated', {
                workerId: this.workerId,
                config: newConfig
            });
        } catch (error) {
            this.sendMessage('error', {
                workerId: this.workerId,
                error: error.message,
                type: 'config_update_error'
            });
        }
    }
}

// Worker initialization
try {
    if (workerData) {
        const worker = new CPUWorker(workerData);
        
        // Handle messages from parent
        parentPort.on('message', (message) => {
            try {
                worker.handleMessage(message);
            } catch (error) {
                worker.sendMessage('error', {
                    workerId: worker.workerId,
                    error: error.message,
                    type: 'message_handling_error'
                });
            }
        });
        
        // Start worker automatically
        worker.start();
        
        // Handle worker termination
        process.on('exit', () => {
            try {
                worker.stop();
            } catch (error) {
                // Ignore errors during shutdown
            }
        });
        
        process.on('SIGTERM', () => {
            try {
                worker.stop();
            } catch (error) {
                // Ignore errors during shutdown
            }
            process.exit(0);
        });
        
        process.on('SIGINT', () => {
            try {
                worker.stop();
            } catch (error) {
                // Ignore errors during shutdown
            }
            process.exit(0);
        });
    }
} catch (error) {
    // Send error to parent if initialization fails
    if (parentPort) {
        parentPort.postMessage({
            type: 'error',
            data: {
                workerId: workerData ? workerData.workerId : 'unknown',
                error: error.message,
                type: 'initialization_error'
            }
        });
    }
}

module.exports = CPUWorker; 