/**
 * Intelligent Monitoring System for KBUC Mining
 * Intelligent Monitoring System for KBUC Mining
 */

const os = require('os');
const fs = require('fs-extra');
const path = require('path');

class MonitoringSystem {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger.child({ component: 'MonitoringSystem' });
        
        this.isRunning = false;
        this.monitoringInterval = null;
        this.systemMetricsInterval = null;
        
        // System metrics
        this.systemMetrics = {
            cpuUsage: 0,
            memoryUsage: 0,
            temperature: 0,
            powerConsumption: 0,
            uptime: 0,
            lastUpdate: Date.now()
        };
        
        // Performance history
        this.performanceHistory = [];
        this.maxHistorySize = 1000;
        
        // Alerts
        this.alerts = [];
        this.alertThresholds = {
            hashRateDrop: config.get('monitoring.alerts.hashRateDrop', 50),
            highCpuUsage: config.get('monitoring.alerts.highCpuUsage', 90),
            highMemoryUsage: config.get('monitoring.alerts.highMemoryUsage', 85),
            lowHashRate: config.get('monitoring.alerts.lowHashRate', 0.1)
        };
        
        // Notification system
        this.notifications = {
            email: null,
            webhook: null
        };
    }

    /**
     * Initialize monitoring system
     * تهيئة نظام المراقبة
     */
    async initialize() {
        try {
            this.logger.debug('Initializing monitoring system...');

            // Initialize notification systems
            await this.initializeNotifications();

            // // Create monitoring directories
            await this.createMonitoringDirectories();

            // // Load historical data if exists
            await this.loadHistoricalData();

            this.logger.info('✅ Monitoring system initialized successfully');

        } catch (error) {
            this.logger.error('Failed to initialize monitoring system', { error: error.message });
            throw error;
        }
    }

    /**
     * Initialize notification systems
     * تهيئة أنظمة الإشعارات
     */
    async initializeNotifications() {
        // Notifications disabled in new config structure
        const notificationConfig = { enabled: false };

        if (notificationConfig.enabled) {
            // Initialize email notifications
            if (notificationConfig.providers.email.enabled) {
                this.notifications.email = this.createEmailNotifier(notificationConfig.providers.email);
            }

            // Initialize webhook notifications
            if (notificationConfig.providers.webhook.enabled) {
                this.notifications.webhook = this.createWebhookNotifier(notificationConfig.providers.webhook);
            }
        }
    }

    /**
     * Create email notifier
     * إنشاء مبلغ البريد الإلكتروني
     */
    createEmailNotifier(config) {
        // Email notification implementation
        return {
            send: async (subject, message) => {
                this.logger.info('Email notification sent', { subject, message });
                // Implement email sending logic here
            }
        };
    }

    /**
     * Create webhook notifier
     * إنشاء مبلغ Webhook
     */
    createWebhookNotifier(config) {
        // Webhook notification implementation
        return {
            send: async (data) => {
                this.logger.info('Webhook notification sent', { data });
                // Implement webhook sending logic here
            }
        };
    }

    /**
     * Create monitoring directories
     * إنشاء مجلدات المراقبة
     */
    async createMonitoringDirectories() {
        const dirs = [
            'logs/monitoring',
            'data/metrics',
            'data/alerts'
        ];

        for (const dir of dirs) {
            await fs.ensureDir(dir);
        }
    }

    /**
     * Load historical data
     * تحميل البيانات التاريخية
     */
    async loadHistoricalData() {
        try {
            const metricsFile = 'data/metrics/history.json';
            
            if (await fs.pathExists(metricsFile)) {
                const data = await fs.readFile(metricsFile, 'utf8');
                this.performanceHistory = JSON.parse(data);
                this.logger.info('Historical data loaded', { entries: this.performanceHistory.length });
            }
        } catch (error) {
            this.logger.warn('Failed to load historical data', { error: error.message });
        }
    }

    /**
     * Start monitoring
     * بدء المراقبة
     */
    async start() {
        try {
            this.logger.info('Starting monitoring system...');

            this.isRunning = true;

            // Start monitoring loop
            this.startMonitoringLoop();

            // Start system metrics collection
            this.startSystemMetricsCollection();

            this.logger.info('Monitoring system started successfully');

        } catch (error) {
            this.logger.error('Failed to start monitoring system', { error: error.message });
            throw error;
        }
    }

    /**
     * Start monitoring loop
     * بدء حلقة المراقبة
     */
    startMonitoringLoop() {
        const interval = this.config.get('monitoring.interval', 5000);
        
        this.monitoringInterval = setInterval(async () => {
            if (this.isRunning) {
                await this.collectMetrics();
                await this.checkAlerts();
                await this.saveMetrics();
            }
        }, interval);
    }

    /**
     * Start system metrics collection
     * بدء جمع مقاييس النظام
     */
    startSystemMetricsCollection() {
        // Ensure only one interval is active
        if (this.systemMetricsInterval) {
            clearInterval(this.systemMetricsInterval);
            this.systemMetricsInterval = null;
        }

        this.systemMetricsInterval = setInterval(async () => {
            if (this.isRunning) {
                await this.updateSystemMetrics();
            }
        }, 5000); // Update every 5 seconds
    }

    /**
     * Collect system metrics
     * جمع مقاييس النظام
     */
    async updateSystemMetrics() {
        try {
            // CPU usage
            this.systemMetrics.cpuUsage = await this.getCPUUsage();

            // Memory usage
            this.systemMetrics.memoryUsage = this.getMemoryUsage();

            // System uptime
            this.systemMetrics.uptime = os.uptime();

            // Temperature (if available)
            this.systemMetrics.temperature = await this.getTemperature();

            // Power consumption (estimated)
            this.systemMetrics.powerConsumption = this.estimatePowerConsumption();

            this.systemMetrics.lastUpdate = Date.now();

        } catch (error) {
            this.logger.error('Failed to update system metrics', { error: error.message });
        }
    }

    /**
     * Get CPU usage percentage
     * الحصول على نسبة استخدام CPU
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
     * Get memory usage percentage
     * الحصول على نسبة استخدام الذاكرة
     */
    getMemoryUsage() {
        try {
            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            const usage = ((totalMem - freeMem) / totalMem) * 100;
            return Math.round(usage * 100) / 100;
        } catch (error) {
            this.logger.error('Failed to get memory usage', { error: error.message });
            return 0;
        }
    }

    /**
     * Get system temperature
     * الحصول على درجة حرارة النظام
     */
    async getTemperature() {
        try {
            // This would require system-specific implementation
            // For now, return a simulated temperature
            return 45 + Math.random() * 20; // 45-65°C
        } catch (error) {
            this.logger.warn('Failed to get temperature', { error: error.message });
            return 0;
        }
    }

    /**
     * Estimate power consumption
     * تقدير استهلاك الطاقة
     */
    estimatePowerConsumption() {
        try {
            // Simple estimation based on CPU usage
            const basePower = 50; // Base power in watts
            const cpuPower = this.systemMetrics.cpuUsage * 0.5; // 0.5W per % CPU
            return Math.round((basePower + cpuPower) * 100) / 100;
        } catch (error) {
            this.logger.warn('Failed to estimate power consumption', { error: error.message });
            return 0;
        }
    }

    /**
     * Collect mining metrics
     * جمع مقاييس التعدين
     */
    async collectMetrics() {
        try {
            const metrics = {
                timestamp: Date.now(),
                system: { ...this.systemMetrics },
                mining: {
                    hashRate: 0,
                    totalHashes: 0,
                    solutions: 0,
                    workers: 0
                }
            };

            // Add to performance history
            this.performanceHistory.push(metrics);

            // Keep history size manageable
            if (this.performanceHistory.length > this.maxHistorySize) {
                this.performanceHistory = this.performanceHistory.slice(-this.maxHistorySize);
            }

            this.logger.debug('Metrics collected', { timestamp: metrics.timestamp });

        } catch (error) {
            this.logger.error('Failed to collect metrics', { error: error.message });
        }
    }

    /**
     * Check for alerts
     * التحقق من التنبيهات
     */
    async checkAlerts() {
        try {
            const alerts = [];

            // Check CPU usage
            if (this.systemMetrics.cpuUsage > this.alertThresholds.highCpuUsage) {
                alerts.push({
                    type: 'high_cpu_usage',
                    severity: 'warning',
                    message: `High CPU usage: ${this.systemMetrics.cpuUsage}%`,
                    value: this.systemMetrics.cpuUsage,
                    threshold: this.alertThresholds.highCpuUsage
                });
            }

            // Check memory usage
            if (this.systemMetrics.memoryUsage > this.alertThresholds.highMemoryUsage) {
                alerts.push({
                    type: 'high_memory_usage',
                    severity: 'warning',
                    message: `High memory usage: ${this.systemMetrics.memoryUsage}%`,
                    value: this.systemMetrics.memoryUsage,
                    threshold: this.alertThresholds.highMemoryUsage
                });
            }

            // Check temperature
            if (this.systemMetrics.temperature > 80) {
                alerts.push({
                    type: 'high_temperature',
                    severity: 'critical',
                    message: `High temperature: ${this.systemMetrics.temperature}°C`,
                    value: this.systemMetrics.temperature,
                    threshold: 80
                });
            }

            // Process alerts
            for (const alert of alerts) {
                await this.processAlert(alert);
            }

        } catch (error) {
            this.logger.error('Failed to check alerts', { error: error.message });
        }
    }

    /**
     * Process alert
     * معالجة التنبيه
     */
    async processAlert(alert) {
        try {
            // Add to alerts history
            this.alerts.push({
                ...alert,
                timestamp: Date.now()
            });

            // Log alert
            this.logger.warn('Alert triggered', alert);

            // Send notifications
            await this.sendNotifications(alert);

            // Save alert
            await this.saveAlert(alert);

        } catch (error) {
            this.logger.error('Failed to process alert', { error: error.message });
        }
    }

    /**
     * Send notifications
     * إرسال الإشعارات
     */
    async sendNotifications(alert) {
        try {
            const message = `[${alert.severity.toUpperCase()}] ${alert.message}`;

            // Send email notification
            if (this.notifications.email) {
                await this.notifications.email.send('Mining Alert', message);
            }

            // Send webhook notification
            if (this.notifications.webhook) {
                await this.notifications.webhook.send({
                    alert: alert,
                    system: this.systemMetrics,
                    timestamp: new Date().toISOString()
                });
            }

        } catch (error) {
            this.logger.error('Failed to send notifications', { error: error.message });
        }
    }

    /**
     * Save alert to file
     * حفظ التنبيه في ملف
     */
    async saveAlert(alert) {
        try {
            const alertFile = `data/alerts/alert_${Date.now()}.json`;
            await fs.writeFile(alertFile, JSON.stringify(alert, null, 2));
        } catch (error) {
            this.logger.error('Failed to save alert', { error: error.message });
        }
    }

    /**
     * Save metrics to file
     * حفظ المقاييس في ملف
     */
    async saveMetrics() {
        try {
            const metricsFile = 'data/metrics/history.json';
            await fs.writeFile(metricsFile, JSON.stringify(this.performanceHistory, null, 2));
        } catch (error) {
            this.logger.error('Failed to save metrics', { error: error.message });
        }
    }

    /**
     * Get system statistics
     * الحصول على إحصائيات النظام
     */
    async getSystemStats() {
        return {
            ...this.systemMetrics,
            alerts: this.alerts.length,
            performanceHistory: this.performanceHistory.length
        };
    }

    /**
     * Check alerts with mining stats
     * التحقق من التنبيهات مع إحصائيات التعدين
     */
    async checkAlertsWithMiningStats(miningStats, systemStats) {
        try {
            // Ensure miningStats exists and has required properties
            if (!miningStats) {
                this.logger.warn('No mining stats provided for alert checking');
                return;
            }

            const alerts = [];

            // Check hash rate drop
            const hashRate = miningStats.hashRate || 0;
            if (hashRate < this.alertThresholds.lowHashRate) {
                alerts.push({
                    type: 'low_hash_rate',
                    severity: 'warning',
                    message: `Low hash rate: ${hashRate.toFixed(2)} MH/s`,
                    value: hashRate,
                    threshold: this.alertThresholds.lowHashRate
                });
            }

            // Check for significant hash rate drop
            if (this.performanceHistory.length > 1) {
                const previousHashRate = this.performanceHistory[this.performanceHistory.length - 2].mining?.hashRate || 0;
                const currentHashRate = hashRate;
                const dropPercentage = previousHashRate > 0 ? ((previousHashRate - currentHashRate) / previousHashRate) * 100 : 0;

                if (dropPercentage > this.alertThresholds.hashRateDrop) {
                    alerts.push({
                        type: 'hash_rate_drop',
                        severity: 'warning',
                        message: `Hash rate dropped by ${dropPercentage.toFixed(1)}%`,
                        value: dropPercentage,
                        threshold: this.alertThresholds.hashRateDrop
                    });
                }
            }

            // Process alerts
            for (const alert of alerts) {
                await this.processAlert(alert);
            }

        } catch (error) {
            this.logger.error('Failed to check mining alerts', { error: error.message });
        }
    }

    /**
     * Get monitoring health
     * الحصول على صحة المراقبة
     */
    async getHealth() {
        return {
            status: this.isRunning ? 'healthy' : 'stopped',
            uptime: Date.now() - this.systemMetrics.lastUpdate,
            metricsCollected: this.performanceHistory.length,
            alertsGenerated: this.alerts.length,
            systemMetrics: this.systemMetrics
        };
    }

    /**
     * Stop monitoring
     * إيقاف المراقبة
     */
    async stop() {
        try {
            this.logger.info('Stopping monitoring system...');

            this.isRunning = false;

            // Stop monitoring loop
            if (this.monitoringInterval) {
                clearInterval(this.monitoringInterval);
                this.monitoringInterval = null;
            }

            // Stop system metrics collection loop
            if (this.systemMetricsInterval) {
                clearInterval(this.systemMetricsInterval);
                this.systemMetricsInterval = null;
            }

            // Save final metrics
            await this.saveMetrics();

            this.logger.info('Monitoring system stopped successfully');

        } catch (error) {
            this.logger.error('Failed to stop monitoring system', { error: error.message });
            throw error;
        }
    }
}

module.exports = MonitoringSystem; 