#!/usr/bin/env node

/**
 * KBUC Mining System - Main Entry Point
 * نظام التعدين الذكي لـ KBUC
 */

const { program } = require('commander');
const kleur = require('kleur');
const fs = require('fs-extra');
const os = require('os');

// Import core modules
const ConfigManager = require('./core/ConfigManager');
const Logger = require('./core/Logger');
const MiningSystem = require('./core/MiningSystem');
const MonitoringSystem = require('./core/MonitoringSystem');
const WebServer = require('./core/WebServer');

// Global variables
let config;
let logger;
let miningSystem;
let monitoringSystem;
let webServer;
let mainMonitoringInterval = null;

// ASCII Art Banner
const BANNER = `
${kleur.cyan('╔═══════════════════════════════════════════════════════╗')}
${kleur.cyan('║    ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██    ║')}
${kleur.cyan('║    ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██    ║')}
${kleur.cyan('║                                                       ║')}
${kleur.cyan('║               KBUC Mining System v1.0.0               ║')}
${kleur.cyan('║                                                       ║')}
${kleur.cyan('║    ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██    ║')}
${kleur.cyan('║    ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██ ██    ║')}
${kleur.cyan('╚═══════════════════════════════════════════════════════╝')}
`;

/**
 * Initialize the mining system
 * تهيئة نظام التعدين
 */
async function initialize() {
    try {
        console.log(kleur.cyan(BANNER));
        // Load configuration
        config = new ConfigManager();
        await config.load();
        
        // Display system info
        await displaySystemInfo();
        console.log(kleur.yellow('🚀 Starting mining system initialization...'));


        // Initialize logger
        logger = new Logger(config.get('logging'));
        if (logger && logger.info) {
            logger.debug('System initialization started');
        }

        // Create necessary directories
        await createDirectories();

        // Initialize core systems
        miningSystem = new MiningSystem(config, logger);
        monitoringSystem = new MonitoringSystem(config, logger);
        webServer = new WebServer(config, logger, miningSystem);

        // Initialize systems
        if (webServer && webServer.initialize) {
            await webServer.initialize();
        }
		if (miningSystem && miningSystem.initialize) {
            await miningSystem.initialize();
        }
        if (monitoringSystem && monitoringSystem.initialize) {
            await monitoringSystem.initialize();
        }
        console.log(kleur.green('✅ System initialized successfully!\n'));

    } catch (error) {
        console.error(kleur.red('❌ Error initializing system:'), error.message);
        if (logger && logger.error) {
            logger.error('Error initializing system:', error);
        }
        process.exit(1);
    }
}

/**
 * Create necessary directories
 * إنشاء المجلدات المطلوبة
 */
async function createDirectories() {
    const dirs = [
        'logs',
        'data/solutions',
        'data/state',
        'data/backup',
        'src'
    ];

    for (const dir of dirs) {
        await fs.ensureDir(dir);
    }
}

/**
 * Start the mining system
 * بدء نظام التعدين
 */
async function start() {
    try {
        console.log(kleur.blue('⛏️ Starting mining...'));

        // Start all systems
        await webServer.start();
        await miningSystem.start();
        await monitoringSystem.start();


        // Start monitoring loop
        startMonitoringLoop();

    } catch (error) {
        if (logger && logger.error) {
            logger.error('Failed to start mining system:', error);
        }
        console.error(kleur.red('❌ Failed to start mining system:'), error.message);
        process.exit(1);
    }
}

/**
 * Display system information
 * عرض معلومات النظام
 */
async function displaySystemInfo() {
    const systemInfo = {
        'System Name': config.get('system.name'),
        'Version': config.get('system.version'),
        'Environment': config.get('system.environment'),
        'API Endpoint': `http://${config.get('network.api.host')}:${config.get('network.api.port')}`,
        'Max Workers': config.get('performance.workers.maxCount'),
        'Mining Mode': config.get('engines.gpu.enabled') ? '🎮 WebGPU Mining' : '🖥️ CPU Mining',
        'Platform': os.platform(),
        'Architecture': os.arch(),
        'CPU Cores': os.cpus().length,
        'Total Memory': `${Math.round(os.totalmem() / 1024 / 1024 / 1024)} GB`
    };

    // Get GPU information
    const gpusInfo = [];
    
    try {
        // Get GPU hardware info
        if (os.platform() === 'win32') {
            const { exec } = require('child_process');
            const gpuOutput = await new Promise((resolve, reject) => {
                exec('wmic path win32_VideoController get name,adapterram,driverversion /format:list', (error, stdout) => {
                    if (error) reject(error);
                    else resolve(stdout);
                });
            });
            
            // Parse GPU info
            const lines = gpuOutput.split('\n');
            let currentGPU = {};
            
            for (const line of lines) {
                if (line.trim() === '') {
                    if (Object.keys(currentGPU).length > 0) {
                        gpusInfo.push({ ...currentGPU });
                        currentGPU = {};
                    }
                } else if (line.includes('Name=')) {
                    currentGPU.name = line.split('=')[1].trim();
                } else if (line.includes('AdapterRAM=')) {
                    const ram = parseInt(line.split('=')[1]);
                    currentGPU.memory = ram ? Math.round(ram / (1024 * 1024)) + ' MB' : 'Unknown';
                } else if (line.includes('DriverVersion=')) {
                    currentGPU.driver = line.split('=')[1].trim();
                }
            }
            
            if (Object.keys(currentGPU).length > 0) {
                gpusInfo.push(currentGPU);
            }
        }
        
    } catch (error) {
        // GPU info not available
    }

    console.log();
    console.log(kleur.cyan('📊 System Information:'));
    console.log(kleur.cyan('═══════════════════════════════════════'));
    
    Object.entries(systemInfo).forEach(([key, value]) => {
        console.log(kleur.white(`${key}: ${kleur.green(value)}`));
    });
    
    console.log();
    console.log(kleur.cyan('🖥️  GPU Information:'));
    console.log(kleur.cyan('═══════════════════════════════════════'));
    
    if (gpusInfo && gpusInfo.length > 0) {
        gpusInfo.forEach((gpu, index) => {
            console.log(kleur.white(`📊 GPU ${index + 1}:`));
            console.log(kleur.white(`  Name: ${kleur.green(gpu.name || 'Unknown')}`));
            if (gpu.memory) {
                console.log(kleur.white(`  Memory: ${kleur.green(gpu.memory)}`));
            }
            if (gpu.driver) {
                console.log(kleur.white(`  Driver: ${kleur.green(gpu.driver)}`));
            }
        });
    } else {
        console.log(kleur.yellow('⚠️ No GPU detected'));
        console.log(kleur.green('🎯 System will use CPU-only mining'));
    }
    
    console.log(kleur.cyan('═══════════════════════════════════════\n'));
}

/**
 * Start monitoring loop
 * بدء حلقة المراقبة
 */
function startMonitoringLoop() {
    // Ensure only one interval is active
    if (mainMonitoringInterval) {
        clearInterval(mainMonitoringInterval);
        mainMonitoringInterval = null;
    }

    mainMonitoringInterval = setInterval(async () => {
        try {
            const stats = await miningSystem.getStats();
            const systemStats = await monitoringSystem.getSystemStats();
            
            // Display real-time stats
            displayStats(stats, systemStats);
            
            // Check for alerts
            if (stats && systemStats) {
                await monitoringSystem.checkAlertsWithMiningStats(stats, systemStats);
            }
            
        } catch (error) {
            if (logger && logger.error) {
                logger.error('Error in monitoring loop:', error);
            }
        }
    }, config.get('monitoring.interval'));
}

/**
 * Display real-time statistics
 * عرض الإحصائيات المباشرة
 */
function displayStats(miningStats, systemStats) {
    // Validate stats
    if (!miningStats || !systemStats) {
        console.log(kleur.yellow('⚠️ Waiting for mining statistics...'));
        return;
    }

    const hashRate = miningStats.hashRate || 0;
    const totalHashes = miningStats.totalHashes || 0;
    const solutions = miningStats.solutions || 0;
    const cpuUsage = systemStats.cpuUsage || 0;
    const memoryUsage = systemStats.memoryUsage || 0;
    const uptime = Math.floor((Date.now() - (miningStats.startTime || Date.now())) / 1000);

    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = uptime % 60;

    // Clear screen and move cursor to top (Windows compatible)
    try {
        if (process.platform === 'win32') {
            // Use cls command for Windows
            require('child_process').execSync('cls', { stdio: 'ignore' });
        } else {
            process.stdout.write('\x1B[2J\x1B[H');
        }
    } catch (error) {
        // Fallback to simple newlines if clearing fails
        console.log('\n'.repeat(50));
    }
    
    // Display real-time stats only (no banner or system info)
    console.log(kleur.yellow('📈 Real-time Statistics:'));
    console.log(kleur.cyan('═══════════════════════════════════════'));
    
    // Format hash rate properly (convert from H/s to MH/s if needed)
    let formattedHashRate = Math.max(0, hashRate); // Ensure non-negative
    let hashRateUnit = 'H/s';
    
    if (formattedHashRate >= 1000000) {
        formattedHashRate = (formattedHashRate / 1000000).toFixed(2);
        hashRateUnit = 'MH/s';
    } else if (formattedHashRate >= 1000) {
        formattedHashRate = (formattedHashRate / 1000).toFixed(2);
        hashRateUnit = 'KH/s';
    } else {
        formattedHashRate = formattedHashRate.toFixed(2);
    }
    
    console.log(kleur.white(`⛏️ Hash Rate: ${kleur.green(formattedHashRate)} ${hashRateUnit}`));
    console.log(kleur.white(`📊 Total Hashes: ${kleur.green(totalHashes.toLocaleString())}`));
    console.log(kleur.white(`🎯 Solutions: ${kleur.green(solutions)}`));
    console.log(kleur.white(`⏱️ Uptime: ${kleur.green(`${hours}h ${minutes}m ${seconds}s`)}`));
    console.log(kleur.white(`💻 CPU Usage: ${kleur.green(cpuUsage.toFixed(1))}%`));
    console.log(kleur.white(`💾 Memory Usage: ${kleur.green(memoryUsage.toFixed(1))}%`));

    console.log(kleur.cyan('═══════════════════════════════════════'));
}

/**
 * Graceful shutdown
 * إيقاف النظام بشكل آمن
 */
const gracefulShutdown = async (signal) => {
    if (logger) {
        logger.info(`🛑 Received signal ${signal}, shutting down system...`);
    } else {
        console.log(`🛑 Received signal ${signal}, shutting down system...`);
    }
    
    try {
        // Stop main monitoring loop interval first to prevent further work
        if (mainMonitoringInterval) {
            clearInterval(mainMonitoringInterval);
            mainMonitoringInterval = null;
        }

        // Stop web server
        if (webServer) {
            if (logger) {
                logger.info('Stopping web server...', { component: 'WebServer' });
            } else {
                console.log('Stopping web server...');
            }
            await webServer.stop();
            if (logger) {
                logger.info('Web server stopped', { component: 'WebServer' });
            } else {
                console.log('Web server stopped');
            }
        }

        // Stop monitoring system
        if (monitoringSystem) {
            if (logger) {
                logger.info('Stopping monitoring system...', { component: 'MonitoringSystem' });
            } else {
                console.log('Stopping monitoring system...');
            }
            await monitoringSystem.stop();
            if (logger) {
                logger.info('Monitoring system stopped successfully', { component: 'MonitoringSystem' });
            } else {
                console.log('Monitoring system stopped successfully');
            }
        }

        // Stop mining system last
        if (miningSystem) {
            if (logger) {
                logger.info('Stopping mining system...', { component: 'MiningSystem' });
            } else {
                console.log('Stopping mining system...');
            }
            await miningSystem.stop();
            // Avoid duplicate log: MiningSystem.stop() already logs success
            if (!logger) {
                console.log('Mining system stopped successfully');
            }
        }

        if (logger) {
            logger.info('System shutdown completed');
        }
        console.log('📝 📝 📝 📝 📝 ✅ System shutdown completed successfully');
        
        // Critical: Wait for WebGPU native cleanup before exit
        if (logger) {
            logger.debug('Waiting for WebGPU native cleanup before exit...');
        } else {
            console.log('Waiting for WebGPU native cleanup before exit...');
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        process.exit(0);
        
    } catch (error) {
        if (logger) {
            logger.error('Error during shutdown', { error: error.message });
        }
        console.error('❌ Error during shutdown:', error.message);
        
        // Even on error, wait for cleanup to prevent native crashes
        await new Promise(resolve => setTimeout(resolve, 1000));
        process.exit(1);
    }
};

/**
 * Setup command line interface
 * إعداد واجهة سطر الأوامر
 */
function setupCLI() {
    program
        .name('kbuc-miner')
        .description('KBUC Mining System')
        .version('1.0.0');

    program
        .command('start', { isDefault: true })
        .description('Start the mining system')
        .option('-c, --config <path>', 'Configuration file path')
        .option('-d, --debug', 'Enable debug mode')
        .action(async (options) => {
            if (options.config) {
                process.env.CONFIG_PATH = options.config;
            }
            if (options.debug) {
                process.env.DEBUG = 'true';
            }
            
            await initialize();
            await start();
        });

    program
        .command('status')
        .description('Show system status')
        .action(async () => {
            await initialize();
            const stats = await miningSystem.getStats();
            console.log(JSON.stringify(stats, null, 2));
        });

    program
        .command('config')
        .description('Show current configuration')
        .action(() => {
            console.log(JSON.stringify(config.getAll(), null, 2));
        });

    return program.parseAsync();
}

/**
 * Setup signal handlers
 * إعداد معالجات الإشارات
 */
function setupSignalHandlers() {
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('uncaughtException', (error) => {
        if (logger) {
            logger.error('Uncaught Exception:', error);
        } else {
            console.error('Uncaught Exception:', error);
        }
        gracefulShutdown('uncaughtException');
    });
    process.on('unhandledRejection', (reason, promise) => {
        if (logger) {
            logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
        } else {
            console.error('Unhandled Rejection at:', promise, 'reason:', reason);
        }
        gracefulShutdown('unhandledRejection');
    });
}

/**
 * Main entry point
 * نقطة الدخول الرئيسية
 */
(async () => {
    try {
        // Setup signal handlers
        setupSignalHandlers();

        // Setup CLI
        setupCLI();
        
    } catch (error) {
        console.error(kleur.red('❌ Error in main system:'), error.message);
        if (logger && logger.error) {
            logger.error('Error in main system:', error);
        }
        process.exit(1);
    }
})();


module.exports = {
    initialize,
    start,
    gracefulShutdown,
    miningSystem,
    monitoringSystem,
    webServer
}; 