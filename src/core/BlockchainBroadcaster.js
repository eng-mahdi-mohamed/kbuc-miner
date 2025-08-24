const axios = require("axios");

/**
 * Blockchain Broadcaster
 * Handles broadcasting of support tickets and solutions to the blockchain
 */
class BlockchainBroadcaster {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.rpcConfig = config.get("rpc");
  }

  /**
   * Broadcast support ticket to blockchain
   * @param {Object} solution - Solution object with nonce, hash, etc.
   * @returns {Promise<boolean>} Success status
   */
  async broadcastSupportTicket(solution) {
    try {
      // Validate solution object
      if (!solution || typeof solution !== "object") {
        throw new Error("Invalid solution object");
      }

      if (!solution.nonce || !solution.hash) {
        throw new Error("Solution missing required fields: nonce and hash");
      }

      // Log the complete solution object for debugging
      this.logger.debug("Processing solution for broadcast", {
        nonce: solution.nonce,
        hash: solution.hash,
      });
      // Build RPC URL correctly
      let rpcUrl;
      if (
        this.rpcConfig.host.startsWith("http://") ||
        this.rpcConfig.host.startsWith("https://")
      ) {
        rpcUrl = this.rpcConfig.host;
      } else {
        // Ensure proper protocol
        const protocol = this.rpcConfig.port === 443 ? "https://" : "http://";
        rpcUrl = `${protocol}${this.rpcConfig.host}:${this.rpcConfig.port}`;
      }

      const auth =
        this.rpcConfig.user && this.rpcConfig.password
          ? `${this.rpcConfig.user}:${this.rpcConfig.password}`
          : null;

      // Validate ticket data format
      // Expected format: 20 + hash(32) + 14 + leaderAddress(20) + blockHeight(4) + 14 + rewardAddress(20) + miningType(1) + timestamp(4) + nonce(4)
      // Total expected length: 2 + 64 + 2 + 40 + 8 + 2 + 40 + 2 + 8 + 8 = 176 characters
      if (!solution.header || solution.header.length !== 176) {
        throw new Error(
          `Invalid ticket data length: ${
            solution.header ? solution.header.length : 0
          }, expected 176`
        );
      }

      const requestData = {
        jsonrpc: "1.0",
        id: "broadcast_request",
        method: "broadcastsupportticket",
        params: [solution.header],
      };

      const headers = {
        "Content-Type": "application/json",
      };

      if (auth) {
        headers["Authorization"] = `Basic ${Buffer.from(auth).toString(
          "base64"
        )}`;
      }

      this.logger.debug("Broadcasting support ticket to blockchain", {
        nonce: solution.nonce,
        hash: solution.hash,
        rpcUrl,
        ticketDataLength: solution.header.length,
        ticketDataPreview: solution.header.substring(0, 64) + "...",
      });

      const response = await axios.post(rpcUrl, requestData, {
        headers,
        timeout: this.rpcConfig.timeout || 30000,
      });

      // Log response for debugging
      this.logger.debug("RPC Response received", {
        status: response.status,
        statusText: response.statusText,
        data: response.data,
        nonce: solution.nonce,
        hash: solution.hash,
        requestData: requestData,
      });

      if (response.data.error) {
        throw new Error(
          `RPC Error: ${
            response.data.error.message ||
            response.data.error ||
            "Unknown error"
          }`
        );
      }

      this.logger.debug("Support ticket broadcasted successfully", {
        nonce: solution.nonce,
        hash: solution.hash,
      });

      return true;
    } catch (error) {
      this.logger.error("Failed to broadcast support ticket", {
        error: error.message,
        errorCode: error.code,
        errorStatus: error.response?.status,
        errorStatusText: error.response?.statusText,
        errorData: error.response?.data,
        config: solution.config,
        nonce: solution.nonce,
        hash: solution.hash,
        rpcUrl: `${this.rpcConfig.host}:${this.rpcConfig.port}`,
      });
      return false;
    }
  }

  /**
   * Check if broadcasting is enabled
   * @returns {boolean} Broadcasting enabled status
   */
  isBroadcastingEnabled() {
    return this.config.get("support_hash_broadcast.enabled", true);
  }

  /**
   * Get broadcast mode
   * @returns {string} Broadcast mode
   */
  getBroadcastMode() {
    return this.config.get("support_hash_broadcast.mode", "immediate");
  }
}

module.exports = BlockchainBroadcaster;
