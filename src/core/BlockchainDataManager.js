const axios = require('axios');

/**
 * Blockchain Data Manager
 * Manages fetching of support ticket data from blockchain
 * Note: Support ticket data is fetched once at mining start and remains constant during nonce search
 */
class BlockchainDataManager {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.rpcConfig = config.get('rpc');
        this.cache = {
            leaderAddress: null,
            blockHeight: null,
            lastFetch: 0,
            cacheDuration: 300000 // 5 minutes cache (support ticket data is stable)
        };
    }

    /**
     * Get support ticket data from RPC (fetched once at mining start)
     * Support ticket data remains constant during nonce search
     * @returns {Promise<{leaderAddress: string, blockHeight: number}>}
     */
    async getSupportableLeader(retry = false) {
        try {
            // Check cache first - support ticket data is stable
            const now = Date.now();
            if (this.cache.leaderAddress && this.cache.blockHeight && 
                (now - this.cache.lastFetch) < this.cache.cacheDuration) {
                this.logger.debug('Using cached support ticket data', {
                    leaderAddress: this.cache.leaderAddress,
                    blockHeight: this.cache.blockHeight
                });
                return {
                    leaderAddress: this.cache.leaderAddress,
                    blockHeight: this.cache.blockHeight
                };
            }

            // Fetch fresh support ticket data from RPC
            const rpcUrl = `${this.rpcConfig.host}:${this.rpcConfig.port}`;
            const auth = this.rpcConfig.user && this.rpcConfig.password ? 
                `${this.rpcConfig.user}:${this.rpcConfig.password}` : null;

            const requestData = {
                jsonrpc: "1.0",
                id: "miner_request",
                method: "getsupportableleader",
                params: []
            };

            const headers = {
                'Content-Type': 'application/json'
            };

            if (auth) {
                headers['Authorization'] = `Basic ${Buffer.from(auth).toString('base64')}`;
            }

            const response = await axios.post(rpcUrl, requestData, {
                headers,
                timeout: this.rpcConfig.timeout || 30000
            });

            if (response.data.error) {
                throw new Error(`RPC Error: ${response.data.error.message || 'Unknown error'}`);
            }

            if (!response.data.result) {
                throw new Error('No result received from RPC');
            }

            const { leader, height } = response.data.result;
            // if leader not equal to 40 hex characters that means it is CHECKPOINT BLOCK should be retay after 1 minute
            if(leader.length !== 40 && !retry) {
                await new Promise(resolve => setTimeout(resolve, 60000));
                return this.getSupportableLeader(true);
            } else if (leader.length !== 40 && retry) {
                throw new Error(`Invalid leader length: ${leader.length}, expected 40 hex characters`);
            }
            
            // Update cache - this data will remain constant during mining session
            this.cache.leaderAddress = leader;
            this.cache.blockHeight = height;
            this.cache.lastFetch = now;

            this.logger.info('🔄 Successfully fetched support ticket data', {
                leaderAddress: leader,
                blockHeight: height,
                note: 'This data will remain constant during nonce search'
            });

            return { leaderAddress: leader, blockHeight: height };

        } catch (error) {
            this.logger.error('Failed to fetch support ticket data', {
                error: error.message,
                rpcUrl: `${this.rpcConfig.host}:${this.rpcConfig.port}`
            });

            // Return cached data if available, otherwise throw
            if (this.cache.leaderAddress && this.cache.blockHeight) {
                this.logger.warn('Using cached support ticket data due to RPC failure');
                return {
                    leaderAddress: this.cache.leaderAddress,
                    blockHeight: this.cache.blockHeight
                };
            }

            throw error;
        }
    }

    /**
     * Clear the cache to force fresh support ticket data fetch
     * Use this when starting a new mining session
     */
    clearCache() {
        this.cache = {
            leaderAddress: null,
            blockHeight: null,
            lastFetch: 0,
            cacheDuration: 300000 // 5 minutes
        };
        this.logger.debug('Support ticket data cache cleared');
    }

    /**
     * Set cache duration for support ticket data
     * @param {number} duration - Cache duration in milliseconds
     */
    setCacheDuration(duration) {
        this.cache.cacheDuration = duration;
        this.logger.debug('Support ticket data cache duration updated', { duration });
    }

    /**
     * Get current cache status for support ticket data
     * @returns {Object} Cache status
     */
    getCacheStatus() {
        return {
            hasCachedData: !!(this.cache.leaderAddress && this.cache.blockHeight),
            lastFetch: this.cache.lastFetch,
            cacheAge: Date.now() - this.cache.lastFetch,
            cacheDuration: this.cache.cacheDuration,
            isExpired: (Date.now() - this.cache.lastFetch) > this.cache.cacheDuration,
            note: 'Support ticket data remains constant during mining session'
        };
    }
}

module.exports = BlockchainDataManager; 