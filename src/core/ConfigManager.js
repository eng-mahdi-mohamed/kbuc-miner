/**
 * Configuration Manager for KBUC Mining System
 * Configuration Manager for KBUC Mining System
 */

const fs = require('fs-extra');
const path = require('path');
const yaml = require('yaml');

class ConfigManager {
    constructor() {
        this.config = {};
        this.configPath = process.env.CONFIG_PATH || 'config/mining-config.json';
        this.defaultConfig = this.getDefaultConfig();
    }

    /**
     * Get default configuration
     * الحصول على التكوين الافتراضي
     */
    getDefaultConfig() {
        return {
            system: {
                name: "KBUC Mining System",
                version: "1.0.0",
                environment: "production",
                debug: false,
                logLevel: "info"
            },
            api: {
                host: "localhost",
                port: 8001,
                timeout: 30000,
                retryAttempts: 3,
                retryDelay: 5000
            },
            mining: {
                default_ticket_data: "0000000000000000000000000000000000000000000000000000000000000000",
                default_reward_address: "89d66c0a217e90f520ca156d22ead95994ba437a",
                default_difficulty_target: "000000ffffff0000000000000000000000000000000000000000000000000000",
                default_mining_type: 0,
                autoRestart: false,
                restartDelay: 5000,
                maxRestartAttempts: 10,
                max_time_seconds: 1800,
                auto_restart: false,
                restart_delay_seconds: 2,
                max_restart_attempts: 0,
                restart_on_success: false,
                restart_on_failure: false,
                mining_session_timeout: 1800,
                support_sub_solutions: true,
                broadcast_all_solutions: true
            },
            performance: {
                maxWorkers: 8,
                batchSize: 1000000,
                updateInterval: 5000,
                hashRateThreshold: 0.1,
                memoryThreshold: 80,
                cpuThreshold: 90,
                gpuBlocks: 512
            },
            engines: {
                gpu: {
                    enabled: true,
                    priority: "high",
                    webgl: true,
                    webgpu: false,
                    fallback: "cpu"
                },
                cpu: {
                    priority: "medium",
                    threads: "auto",
                    optimization: "balanced"
                },

            },
            monitoring: {
                enabled: true,
                interval: 10000,
                metrics: {
                    hashRate: true,
                    cpuUsage: true,
                    memoryUsage: true,
                    temperature: false,
                    powerConsumption: false
                },
                alerts: {
                    enabled: true,
                    hashRateDrop: 50,
                    highCpuUsage: 90,
                    highMemoryUsage: 85
                }
            },
            logging: {
                level: "info",
                file: "logs/mining.log",
                maxSize: "10m",
                maxFiles: 5,
                console: true,
                format: "json"
            },
            data: {
                solutionsPath: "data/solutions",
                statePath: "data/state",
                backupPath: "data/backup",
                autoBackup: true,
                backupInterval: 3600000
            },
            security: {
                apiKey: "",
                rateLimit: {
                    enabled: true,
                    maxRequests: 100,
                    windowMs: 60000
                },
                cors: {
                    enabled: true,
                    origins: ["*"]
                }
            },
            notifications: {
                enabled: false,
                providers: {
                    email: {
                        enabled: false,
                        smtp: {
                            host: "",
                            port: 587,
                            secure: true,
                            user: "",
                            pass: ""
                        }
                    },
                    webhook: {
                        enabled: false,
                        url: "",
                        headers: {}
                    }
                }
            },
            support_hash_broadcast: {
                enabled: true,
                mode: "immediate",
                batch_size: 5,
                batch_timeout_ms: 5000,
                immediate_broadcast: true
            },
            rpc: {
                host: "https://rpc.kbunet.net",
                port: 443,
                user: "",
                password: "",
                timeout: 30000
            }
        };
    }

    /**
     * Load configuration from file
     * تحميل التكوين من الملف
     */
    async load() {
        try {
            // Check if config file exists
            if (await fs.pathExists(this.configPath)) {
                const configData = await fs.readFile(this.configPath, 'utf8');
                
                // Parse based on file extension
                if (this.configPath.endsWith('.json')) {
                    this.config = JSON.parse(configData);
                } else if (this.configPath.endsWith('.yaml') || this.configPath.endsWith('.yml')) {
                    this.config = yaml.parse(configData);
                } else {
                    throw new Error('Unsupported configuration file format');
                }
                
                console.log(`✅ Configuration loaded from: ${this.configPath}`);
            } else {
                // Create default config file
                await this.createDefaultConfig();
                this.config = this.defaultConfig;
                console.log(`📝 Default configuration file created: ${this.configPath}`);
            }

            // Merge with default config to ensure all properties exist
            this.config = this.mergeConfig(this.defaultConfig, this.config);
            
            // Validate configuration
            this.validateConfig();
            
            return this.config;
            
        } catch (error) {
            console.error(`❌ Error loading configuration: ${error.message}`);
            console.log('🔄 Using default configuration...');
            this.config = this.defaultConfig;
            return this.config;
        }
    }

    /**
     * Create default configuration file
     * إنشاء ملف التكوين الافتراضي
     */
    async createDefaultConfig() {
        try {
            // Ensure config directory exists
            const configDir = path.dirname(this.configPath);
            await fs.ensureDir(configDir);
            
            // Write default config
            const configData = JSON.stringify(this.defaultConfig, null, 2);
            await fs.writeFile(this.configPath, configData, 'utf8');
            
        } catch (error) {
            console.error(`❌ Error creating configuration file: ${error.message}`);
            throw error;
        }
    }

    /**
     * Merge configurations (deep merge)
     * دمج التكوينات (دمج عميق)
     */
    mergeConfig(defaultConfig, userConfig) {
        const merged = { ...defaultConfig };
        
        for (const key in userConfig) {
            if (userConfig.hasOwnProperty(key)) {
                if (typeof userConfig[key] === 'object' && userConfig[key] !== null && 
                    typeof merged[key] === 'object' && merged[key] !== null) {
                    merged[key] = this.mergeConfig(merged[key], userConfig[key]);
                } else {
                    merged[key] = userConfig[key];
                }
            }
        }
        
        return merged;
    }

    /**
     * Validate configuration
     * التحقق من صحة التكوين
     */
    validateConfig() {
        const errors = [];
        
        // Validate required fields
        if (!this.config.system?.name) {
            errors.push('System name is required');
        }
        
        // Support legacy api.port and new network.api.port
        const apiPort = (this.get('api.port') ?? this.get('network.api.port'));
        if (!apiPort || apiPort < 1 || apiPort > 65535) {
            errors.push('API port must be between 1 and 65535');
        }
        
        // Support legacy mining.default_ticket_data and new mining.blockchain.defaultTicketData
        const ticketData = (this.get('mining.default_ticket_data') ?? this.get('mining.blockchain.defaultTicketData'));
        if (!ticketData || String(ticketData).length !== 64) {
            errors.push('Default ticket data must be 64 characters long');
        }
        
        if (this.config.performance?.maxWorkers < 1) {
            errors.push('Max workers must be at least 1');
        }
        
        if (errors.length > 0) {
            throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
        }
    }

    /**
     * Get configuration value by path
     * الحصول على قيمة التكوين حسب المسار
     */
    get(path, defaultValue = null) {
        const keys = path.split('.');
        let value = this.config;
        
        for (const key of keys) {
            if (value && typeof value === 'object' && key in value) {
                value = value[key];
            } else {
                return defaultValue;
            }
        }
        
        return value;
    }

    /**
     * Set configuration value by path
     * تعيين قيمة التكوين حسب المسار
     */
    set(path, value) {
        const keys = path.split('.');
        let current = this.config;
        
        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i];
            if (!(key in current) || typeof current[key] !== 'object') {
                current[key] = {};
            }
            current = current[key];
        }
        
        current[keys[keys.length - 1]] = value;
    }

    /**
     * Get all configuration
     * الحصول على جميع التكوين
     */
    getAll() {
        return this.config;
    }

    /**
     * Save configuration to file
     * حفظ التكوين في الملف
     */
    async save() {
        try {
            const configData = JSON.stringify(this.config, null, 2);
            await fs.writeFile(this.configPath, configData, 'utf8');
            console.log(`✅ Configuration saved to: ${this.configPath}`);
        } catch (error) {
            console.error(`❌ Error saving configuration: ${error.message}`);
            throw error;
        }
    }

    /**
     * Reload configuration
     * إعادة تحميل التكوين
     */
    async reload() {
        await this.load();
    }

    /**
     * Get environment-specific configuration
     * الحصول على التكوين حسب البيئة
     */
    getEnvironmentConfig() {
        const env = this.get('system.environment', 'production');
        const envConfig = this.get(`environments.${env}`, {});
        
        return this.mergeConfig(this.config, envConfig);
    }

    /**
     * Update configuration dynamically
     * تحديث التكوين ديناميكياً
     */
    async update(newConfig) {
        this.config = this.mergeConfig(this.config, newConfig);
        this.validateConfig();
        await this.save();
    }

    /**
     * Reset to default configuration
     * إعادة تعيين للتكوين الافتراضي
     */
    async reset() {
        this.config = this.defaultConfig;
        await this.save();
    }

    /**
     * Export configuration
     * تصدير التكوين
     */
    export(format = 'json') {
        switch (format.toLowerCase()) {
            case 'json':
                return JSON.stringify(this.config, null, 2);
            case 'yaml':
            case 'yml':
                return yaml.stringify(this.config);
            default:
                throw new Error(`Unsupported export format: ${format}`);
        }
    }
}

module.exports = ConfigManager; 