/**
 * Advanced Logger for KBUC Mining System
 * Advanced Logger for KBUC Mining System
 */

const winston = require("winston");
const path = require("path");
const fs = require("fs-extra");
const kleur = require("kleur");

class Logger {
  constructor(config = {}) {
    this.config = {
      level: config.level || "info",
      file: config.file || "logs/mining.log",
      maxSize: config.maxSize || "10m",
      maxFiles: config.maxFiles || 5,
      console: config.console !== false,
      format: config.format || "json",
      ...config,
    };

    this.logger = this.createLogger();
    this.setupConsoleColors();
  }

  /**
   * Safely stringify objects, avoiding circular references and handling Error objects
   */
  safeStringify(obj) {
    try {
      const seen = new WeakSet();
      return JSON.stringify(
        obj,
        (key, value) => {
          if (value instanceof Error) {
            return {
              name: value.name,
              message: value.message,
              stack: value.stack,
            };
          }
          if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) return undefined; // drop circular ref
            seen.add(value);
          }
          return value;
        }
      );
    } catch (e) {
      return '[Unserializable meta]';
    }
  }

  /**
   * Create Winston logger instance
   * إنشاء مثيل Winston للتسجيل
   */
  createLogger() {
    const transports = [];

    // Console transport
    if (this.config.console) {
      transports.push(
        new winston.transports.Console({
          level: this.config.level,
          format: this.getConsoleFormat(),
        })
      );
    }

    // File transport
    if (this.config.file) {
      // Ensure log directory exists
      const logDir = path.dirname(this.config.file);
      fs.ensureDirSync(logDir);

      transports.push(
        new winston.transports.File({
          filename: this.config.file,
          level: this.config.level,
          format: this.getFileFormat(),
          maxsize: this.parseSize(this.config.maxSize),
          maxFiles: this.config.maxFiles,
          tailable: true,
        })
      );
    }

    return winston.createLogger({
      level: this.config.level,
      transports,
      exitOnError: false,
    });
  }

  /**
   * Get console format
   * الحصول على تنسيق وحدة التحكم
   */
  getConsoleFormat() {
    return winston.format.combine(
      winston.format.timestamp({
        format: "YYYY-MM-DD HH:mm:ss",
      }),
      winston.format.errors({ stack: true }),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const color = this.getLevelColor(level);
        const prefix = `${timestamp} [${level.toUpperCase()}]`;
        const metaStr = Object.keys(meta).length
          ? ` ${this.safeStringify(meta)}`
          : "";
        return `${
          typeof color === "function" ? color(prefix) : prefix
        } ${message}${metaStr}`;
      })
    );
  }

  /**
   * Get file format
   * الحصول على تنسيق الملف
   */
  getFileFormat() {
    if (this.config.format === "json") {
      return winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      );
    } else {
      return winston.format.combine(
        winston.format.timestamp({
          format: "YYYY-MM-DD HH:mm:ss",
        }),
        winston.format.errors({ stack: true }),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length
            ? ` ${this.safeStringify(meta)}`
            : "";
          return `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}`;
        })
      );
    }
  }

  /**
   * Get color for log level
   * الحصول على اللون لمستوى التسجيل
   */
  getLevelColor(level) {
    const colors = {
      error: kleur.red,
      warn: kleur.yellow,
      info: kleur.blue,
      debug: kleur.gray,
      verbose: kleur.cyan,
    };
    const color = colors[level] || kleur.white;
    // Ensure we always return a function
    return typeof color === "function" ? color : (text) => text;
  }

  /**
   * Parse size string (e.g., "10m" to bytes)
   * تحليل سلسلة الحجم (مثل "10m" إلى بايت)
   */
  parseSize(sizeStr) {
    const units = {
      b: 1,
      kb: 1024,
      mb: 1024 * 1024,
      gb: 1024 * 1024 * 1024,
    };

    const match = sizeStr
      .toLowerCase()
      .match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/);
    if (!match) {
      return 10 * 1024 * 1024; // Default 10MB
    }

    const value = parseFloat(match[1]);
    const unit = match[2] || "mb";
    return value * (units[unit] || units.mb);
  }

  /**
   * Setup console colors for different log levels
   * إعداد ألوان وحدة التحكم لمستويات التسجيل المختلفة
   */
  setupConsoleColors() {
    // Override console methods for better formatting
    const originalConsole = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
    };

    console.log = (...args) => {
      // originalConsole.log(kleur.blue("📝"), ...args);
      originalConsole.log( ...args);
    };

    console.info = (...args) => {
      originalConsole.info(kleur.cyan("ℹ️"), ...args);
    };

    console.warn = (...args) => {
      originalConsole.warn(kleur.yellow("⚠️"), ...args);
    };

    console.error = (...args) => {
      originalConsole.error(kleur.red("❌"), ...args);
    };

    console.debug = (...args) => {
      if (this.config.level === "debug") {
        originalConsole.debug(kleur.gray("🔍"), ...args);
      }
    };
  }

  /**
   * Log methods
   * طرق التسجيل
   */
  error(message, meta = {}) {
    this.logger.error(message, meta);
  }

  warn(message, meta = {}) {
    this.logger.warn(message, meta);
  }

  info(message, meta = {}) {
    this.logger.info(message, meta);
  }

  debug(message, meta = {}) {
    this.logger.debug(message, meta);
  }

  verbose(message, meta = {}) {
    this.logger.verbose(message, meta);
  }

  logMiningStop(sessionId, reason) {
    this.info("Mining session stopped", {
      sessionId,
      reason,
      timestamp: new Date().toISOString(),
    });
  }

  logSolutionFound(sessionId, nonce, hash) {
    this.info("Solution found!", {
      sessionId,
      nonce,
      hash,
      timestamp: new Date().toISOString(),
    });
  }

  logHashRate(sessionId, hashRate, totalHashes) {
    this.debug("Hash rate update", {
      sessionId,
      hashRate,
      totalHashes,
      timestamp: new Date().toISOString(),
    });
  }

  logSystemStats(cpuUsage, memoryUsage, temperature) {
    this.debug("System statistics", {
      cpuUsage,
      memoryUsage,
      temperature,
      timestamp: new Date().toISOString(),
    });
  }

  logError(error, context = {}) {
    this.error("System error occurred", {
      error: error.message,
      stack: error.stack,
      context,
      timestamp: new Date().toISOString(),
    });
  }

  logPerformance(operation, duration, details = {}) {
    this.debug("Performance measurement", {
      operation,
      duration,
      details,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Create child logger with additional context
   * إنشاء مسجل فرعي مع سياق إضافي
   */
  child(context) {
    const childLogger = new Logger(this.config);
    childLogger.logger = this.logger.child(context);
    return childLogger;
  }

  /**
   * Get log file path
   * الحصول على مسار ملف التسجيل
   */
  getLogFilePath() {
    return this.config.file;
  }

  /**
   * Get log statistics
   * الحصول على إحصائيات التسجيل
   */
  async getLogStats() {
    try {
      if (this.config.file && (await fs.pathExists(this.config.file))) {
        const stats = await fs.stat(this.config.file);
        return {
          fileSize: stats.size,
          lastModified: stats.mtime,
          logLevel: this.config.level,
          format: this.config.format,
        };
      }
      return null;
    } catch (error) {
      this.error("Failed to get log statistics", { error: error.message });
      return null;
    }
  }

  /**
   * Rotate log files
   * تدوير ملفات التسجيل
   */
  async rotateLogs() {
    try {
      if (this.config.file && (await fs.pathExists(this.config.file))) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const backupPath = `${this.config.file}.${timestamp}`;
        await fs.move(this.config.file, backupPath);
        this.info("Log file rotated", { backupPath });
      }
    } catch (error) {
      this.error("Failed to rotate log files", { error: error.message });
    }
  }

  /**
   * Clear old log files
   * مسح ملفات التسجيل القديمة
   */
  async clearOldLogs() {
    try {
      if (this.config.file) {
        const logDir = path.dirname(this.config.file);
        const files = await fs.readdir(logDir);
        const logFiles = files.filter((file) => file.endsWith(".log"));

        // Keep only the most recent files
        const maxFiles = this.config.maxFiles || 5;
        if (logFiles.length > maxFiles) {
          const sortedFiles = logFiles.sort();
          const filesToDelete = sortedFiles.slice(
            0,
            logFiles.length - maxFiles
          );

          for (const file of filesToDelete) {
            await fs.remove(path.join(logDir, file));
          }

          this.info("Old log files cleared", {
            deletedCount: filesToDelete.length,
          });
        }
      }
    } catch (error) {
      this.error("Failed to clear old log files", { error: error.message });
    }
  }

  /**
   * Close logger
   * إغلاق المسجل
   */
  close() {
    return new Promise((resolve) => {
      this.logger.on("finish", resolve);
      this.logger.end();
    });
  }
}

module.exports = Logger;
