"use strict";

const { spawn } = require("child_process");
const path = require("path");

class WebGPUMiner {
  constructor(config, logger) {
    this.config = config || {};
    this.logger = logger && typeof logger.child === "function" ? logger.child({ component: "WebGPUMiner" }) : console;

    this.isInitialized = false;
    this.isRunning = false;
    this.child = null;

    this._stdoutBuf = "";
    this._stderrBuf = "";

    this.stats = {
      hashRate: 0,
      avgRate: 0,
      lastNonce: 0,
      solutions: 0,
      totalHashes: 0,
      startTime: 0,
      lastUpdate: 0,
    };

    // Resilience / recovery state
    this.stopRequested = false;
    this._isRecovering = false;
    this._restartTimer = null;
    this.consecutiveFailures = 0;

    // Backoff and cooldown configuration (with safe defaults)
    this.initialBackoffMs = this._getGpuCfg("initialBackoffMs", 1000);
    this.maxBackoffMs = this._getGpuCfg("maxBackoffMs", 30000);
    this.cooldownErrorMs = this._getGpuCfg("cooldownMsOnError", 3000);
    this.cooldownDeviceLostMs = this._getGpuCfg("cooldownMsOnDeviceLost", 5000);
    this.fullResetThreshold = this._getGpuCfg("fullResetThreshold", 3);
    this._currentBackoffMs = this.initialBackoffMs;

    this._onReadyResolve = null;
    this._onReadyReject = null;
    this._readyTimer = null;

    this.onSolution = null;
    this.onError = null;
  }

  async initialize() {
    // No heavy init required; keep for parity with WebGPUMiner
    try {
      this.logger.debug("Initializing GPU miner...");
      // Optionally validate miner path exists
      const minerPath = this._getMinerPath();
      if (!minerPath) throw new Error("StandaloneWebGPUWorker.js path not found");
      this.isInitialized = true;
      this.logger.info && this.logger.info("WebGPUMiner initialized");
    } catch (e) {
      this.logger.error && this.logger.error("Failed to initialize WebGPUMiner", { error: e.message });
      throw e;
    }
  }

  _getMinerPath() {
    // Miner script is located at src/workers/StandaloneWebGPUWorker.js
    return path.resolve(__dirname, "../workers/StandaloneWebGPUWorker.js");
  }

  _buildMinerEnv(session) {
    const env = { ...process.env };
    env.STRUCTURED_LOGS = "true";
    env.NODE_ENV = env.NODE_ENV || "production";
    env.KEEP_ALIVE = "false"; // ensure the child exits when it finishes a range

    // Prepare miner configuration from session
    const cfg = (session && session.config) || {};
    const minerConfig = {
      ticket_data: cfg.ticket_data,
      leader_address: cfg.leader_address,
      reward_address: cfg.reward_address,
      block_height: cfg.block_height,
      mining_type: cfg.mining_type,
      timestamp: cfg.timestamp,
      target_hex: cfg.target_hex || cfg.difficulty_target,
      base_nonce: cfg.base_nonce || 0,
    };

    env.MINER_CONFIG = JSON.stringify(minerConfig);
    return env;
  }

  async start(session) {
    if (!this.isInitialized) throw new Error("GPU miner not initialized");
    if (this.isRunning) return;

    this.logger.debug && this.logger.debug("Starting WebGPUMiner", { sessionId: session && session.id });

    // Reset stats
    this.stats.hashRate = 0;
    this.stats.avgRate = 0;
    this.stats.totalHashes = 0;
    this.stats.solutions = 0;
    this.stats.startTime = Date.now();
    this.stats.lastUpdate = Date.now();

    // Track session for solution callbacks (parity with WebGPUMiner)
    this.currentSession = session || null;
    this._sessionId = (session && session.id) || null;

    // Reset recovery flags
    this.stopRequested = false;
    this.consecutiveFailures = 0;
    this._currentBackoffMs = this.initialBackoffMs;

    const minerPath = this._getMinerPath();
    const nodeArgs = ["--expose-gc", minerPath];

    const env = this._buildMinerEnv(session);

    // Start child process
    this.child = spawn(process.execPath || "node", nodeArgs, {
      cwd: path.dirname(minerPath),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.isRunning = true;

    // Setup readiness promise
    const readyPromise = new Promise((resolve, reject) => {
      this._onReadyResolve = resolve;
      this._onReadyReject = reject;
      this._readyTimer = setTimeout(() => {
        try {
          reject(new Error("GPU miner ready timeout"));
        } catch {}
      }, 15000);
    });

    // Wire stdout/stderr with unified line-buffered handler
    if (this.child.stdout) {
      this.child.stdout.setEncoding("utf8");
      this.child.stdout.on("data", (chunk) => this._onStreamData("stdout", chunk));
    }
    if (this.child.stderr) {
      this.child.stderr.setEncoding("utf8");
      this.child.stderr.on("data", (chunk) => this._onStreamData("stderr", chunk));
    }

    // Handle exit
    this.child.on("exit", (code, signal) => {
      // Clear ready timer if still pending
      if (this._readyTimer) {
        clearTimeout(this._readyTimer);
        this._readyTimer = null;
      }
      if (this._onReadyReject) {
        // If it exits before ready, reject the pending start
        try { this._onReadyReject(new Error(`Miner exited before ready (code=${code}, signal=${signal || "none"})`)); } catch {}
        this._onReadyReject = null;
        this._onReadyResolve = null;
      }

      const running = this.isRunning;
      this.isRunning = false;
      this.child = null;

      this.logger.info && this.logger.info("WebGPUMiner exited", { code, signal });
      const wasStopRequested = this.stopRequested;

      // Notify external error handler for non-zero exit
      if (running && code !== 0 && this.onError) {
        try { this.onError({ error: `miner_exit_${code}`, type: "worker_exit_error" }); } catch {}
      }

      // Autonomous recovery if we didn't request stop
      if (running && !wasStopRequested) {
        if (code === 0) {
          // Clean exit indicates nonce space exhausted; notify controller and do NOT auto-restart
          try {
            if (this.onError) { this.onError({ type: "nonce_exhausted" }); }
          } catch {}
          // Controller (MiningSystem) will handle rollover and restart
        } else {
          // Failure path -> backoff restart, maybe full reset
          this.consecutiveFailures++;
          const needFullReset = this.consecutiveFailures >= this.fullResetThreshold;
          const cooldown = Math.min(this._currentBackoffMs, this.maxBackoffMs);
          this._currentBackoffMs = Math.min(this._currentBackoffMs * 2, this.maxBackoffMs);
          this._scheduleRestart(needFullReset ? "full_reset" : "error_restart", {
            cooldownMs: cooldown,
            fullReset: needFullReset,
          });
        }
      }
    });

    // Propagate child errors
    this.child.on("error", (err) => {
      if (this._readyTimer) {
        clearTimeout(this._readyTimer);
        this._readyTimer = null;
      }
      if (this._onReadyReject) {
        try { this._onReadyReject(err); } catch {}
        this._onReadyReject = null;
        this._onReadyResolve = null;
      }
      this.logger.error && this.logger.error("Miner process error", { error: err.message });
      if (this.onError) {
        try { this.onError({ error: err.message, type: "worker_error" }); } catch {}
      }
      // Attempt autonomous recovery
      if (!this.stopRequested) {
        this.consecutiveFailures++;
        const needFullReset = this.consecutiveFailures >= this.fullResetThreshold;
        const cooldown = Math.min(this.cooldownErrorMs, this.maxBackoffMs);
        this._scheduleRestart(needFullReset ? "full_reset" : "error_restart", {
          cooldownMs: cooldown,
          fullReset: needFullReset,
        });
      }
    });

    // Resolve when ready
    return readyPromise;
  }

  async stop() {
    if (!this.child) {
      this.isRunning = false;
      return;
    }

    this.logger.debug && this.logger.debug("Stopping WebGPUMiner...");

    this.stopRequested = true;
    const proc = this.child;
    return new Promise((resolve) => {
      const cleanup = () => {
        if (this._readyTimer) { try { clearTimeout(this._readyTimer); } catch {} this._readyTimer = null; }
        this._onReadyResolve = null;
        this._onReadyReject = null;
        this.child = null;
        this.isRunning = false;
        resolve();
      };

      const onExit = () => {
        try { proc.removeAllListeners(); } catch {}
        cleanup();
      };

      proc.once("exit", onExit);

      try { proc.kill("SIGTERM"); } catch {}

      // Force kill if does not exit in time
      setTimeout(() => {
        if (proc.exitCode == null) {
          try { proc.kill("SIGKILL"); } catch {}
        }
      }, 3000);
    });
  }

  async cleanup() {
    try {
      if (this.isRunning) {
        await this.stop();
      }
      this.isInitialized = false;
      if (this._restartTimer) { try { clearTimeout(this._restartTimer); } catch {} this._restartTimer = null; }
      this._isRecovering = false;
      this.logger.info && this.logger.info("WebGPUMiner cleanup completed");
    } catch (e) {
      this.logger.error && this.logger.error("Cleanup error", { error: e.message });
    }
  }

  async getStats() {
    return {
      ...this.stats,
      uptime: this.stats.startTime ? Date.now() - this.stats.startTime : 0,
      isRunning: this.isRunning,
      gpuCapabilities: { adapterName: "ExternalProcess", deviceLimits: "unknown", features: "unknown" },
      gpuHashRate: this.stats.hashRate,
    };
  }

  async getHealth() {
    return {
      status: this.isRunning ? "healthy" : "stopped",
      uptime: this.stats.startTime ? Date.now() - this.stats.startTime : 0,
      hashRate: this.stats.hashRate,
      solutions: this.stats.solutions,
      gpuUsage: 0,
    };
  }

  setSolutionCallback(callback) {
    this.onSolution = callback;
  }

  setErrorCallback(callback) {
    this.onError = callback;
  }

  setMetricsCallback(callback) {
    this.onMetrics = callback;
  }

  _onStreamData(source, chunk) {
    const bufProp = source === "stderr" ? "_stderrBuf" : "_stdoutBuf";
    this[bufProp] += chunk;
    let idx;
    while ((idx = this[bufProp].indexOf("\n")) !== -1) {
      const line = this[bufProp].slice(0, idx).trim();
      this[bufProp] = this[bufProp].slice(idx + 1);
      if (!line) continue;
      // Try NDJSON first
      try {
        const evt = JSON.parse(line);
        this._handleEvent(evt);
        continue;
      } catch {}
      // Fallback: log non-JSON lines with appropriate level
      const prefix = source === "stderr" ? "[miner-stderr] " : "[miner] ";
      if (source === "stderr") {
        if (this.logger.warn) this.logger.warn(prefix + line);
      } else {
        if (this.logger.debug) this.logger.debug(prefix + line);
      }
    }
  }

  _handleEvent(evt) {
    if (!evt || typeof evt !== "object") return;

    switch (evt.type) {
      case "ready": {
        // evt may include wg and count
        this.logger.info && this.logger.info("Miner ready", { wg: evt.wg, count: evt.count });
        if (this._readyTimer) { try { clearTimeout(this._readyTimer); } catch {} this._readyTimer = null; }
        if (this._onReadyResolve) { try { this._onReadyResolve(); } catch {} }
        this._onReadyResolve = null;
        this._onReadyReject = null;
        break;
      }
      case "metrics": {
        if (Number.isFinite(evt.totalHashes)) this.stats.totalHashes = evt.totalHashes >>> 0;
        if (Number.isFinite(evt.lastNonce)) this.stats.lastNonce = evt.lastNonce >>> 0;
        if (Number.isFinite(evt.rate)) this.stats.hashRate = Math.max(0, evt.rate);
        if (Number.isFinite(evt.avgRate)) this.stats.avgRate = Math.max(0, evt.avgRate);
        this.stats.lastUpdate = Date.now();
        if (this.onMetrics) {
          try {
            this.onMetrics(this._sessionId || null, {
              lastNonce: this.stats.lastNonce,
              rate: this.stats.hashRate,
              avgRate: this.stats.avgRate,
              totalHashes: this.stats.totalHashes,
              timestamp: this.stats.lastUpdate,
            });
          } catch {}
        }
        break;
      }
      case "solution": {
        this.stats.solutions++;
        if (evt && typeof evt.nonce !== "undefined") {
          const nonce = evt.nonce >>> 0;
          if (!this.stats.lastNonce || nonce > this.stats.lastNonce) this.stats.lastNonce = nonce;
        }
        if (this.onSolution) {
          try { this.onSolution(this._sessionId || null, { nonce: evt.nonce, hash: evt.hash, header: evt.header }); } catch {}
        }
        // On valid solution, reset failure streak to encourage faster recovery next time
        this.consecutiveFailures = 0;
        this._currentBackoffMs = this.initialBackoffMs;
        break;
      }
      case "deviceLost": {
        // Escalate and also auto-recover
        if (this.onError) { try { this.onError({ error: evt.reason || "device_lost", type: "device_lost", phase: evt.phase }); } catch {} }
        if (!this.stopRequested) {
          this._scheduleRestart("device_lost", { cooldownMs: this.cooldownDeviceLostMs, fullReset: true });
        }
        break;
      }
      default:
        // Unknown event types are ignored
        break;
    }
  }

  // Helpers
  _getGpuCfg(key, def) {
    try {
      if (this.config && typeof this.config.get === "function") {
        const v = this.config.get(`engines.gpu.${key}`);
        return v !== undefined && v !== null ? v : def;
      }
    } catch {}
    try {
      if (this.config && this.config.engines && this.config.engines.gpu && key in this.config.engines.gpu) {
        const v = this.config.engines.gpu[key];
        return v !== undefined && v !== null ? v : def;
      }
    } catch {}
    return def;
  }

  _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  _scheduleRestart(reason, opts = {}) {
    if (this._isRecovering || this.stopRequested) return;
    this._isRecovering = true;
    const { cooldownMs = 1000, fullReset = false } = opts;
    if (this._restartTimer) { try { clearTimeout(this._restartTimer); } catch {} }
    this.logger.warn && this.logger.warn("Scheduling GPU miner restart", { reason, cooldownMs, fullReset });
    this._restartTimer = setTimeout(async () => {
      try {
        // Ensure previous child is gone
        if (this.child) {
          try { await this.stop(); } catch {}
        }
        if (fullReset) {
          // Clean up and reinitialize
          try { await this.cleanup(); } catch {}
          try { await this.initialize(); } catch {}
          this.consecutiveFailures = 0;
          this._currentBackoffMs = this.initialBackoffMs;
        }
        if (this.currentSession) {
          // Restart with possibly updated session config (e.g., after rollover)
          this.logger.info && this.logger.info("Restarting GPU miner after recovery", { reason });
          try { await this.start(this.currentSession); } catch (e) {
            this.logger.error && this.logger.error("Auto-restart failed", { error: e.message });
          }
        }
      } finally {
        this._isRecovering = false;
      }
    }, Math.max(0, cooldownMs | 0));
  }
}

module.exports = WebGPUMiner;
