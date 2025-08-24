const crypto = require("crypto");

/**
 * Builds the header prefix for mining
 * @param {Object} cfg - Configuration object containing mining parameters
 * @returns {Buffer} The header prefix as a buffer
 */
function buildHeaderPrefix(cfg) {
  try {
    const leader = Buffer.from(cfg.leader_address, "hex");
    const reward = Buffer.from(cfg.reward_address, "hex");
    const buf = Buffer.alloc(1 + 32 + 1 + 20 + 4 + 1 + 20 + 1 + 4);
    let off = 0;
    buf.writeUInt8(32, off);
    off += 1;
    Buffer.alloc(32).copy(buf, off);
    off += 32;
    buf.writeUInt8(20, off);
    off += 1;
    leader.copy(buf, off);
    off += 20;
    buf.writeUInt32LE(cfg.block_height >>> 0, off);
    off += 4;
    buf.writeUInt8(20, off);
    off += 1;
    reward.copy(buf, off);
    off += 20;
    buf.writeUInt8(cfg.mining_type >>> 0, off);
    off += 1;
    buf.writeUInt32LE(cfg.timestamp >>> 0, off);
    off += 4;
    return buf;
  } catch (error) {
    throw new Error(`Failed to build header prefix: ${error.message}`);
  }
}

/**
 * Builds a header with the given nonce
 * @param {Buffer} prefix - The header prefix
 * @param {number} nonce - The nonce to append
 * @returns {Buffer} The complete header with nonce
 */
function buildHeaderWithNonce(prefix, nonce) {
  try {
    const msg = Buffer.alloc(prefix.length + 4);
    prefix.copy(msg, 0);
    msg.writeUInt32LE(nonce >>> 0, prefix.length);
    return msg;
  } catch (error) {
    throw new Error(`Failed to build header with nonce: ${error.message}`);
  }
}

/**
 * Performs double SHA256 hashing
 * @param {Buffer} data - The data to hash
 * @returns {Buffer} The hash result
 */
function doubleSHA256(buf) {
  try {
    const h1 = crypto.createHash("sha256").update(buf).digest();
    const h2 = crypto.createHash("sha256").update(h1).digest();
    return Buffer.from(h2).reverse();
  } catch (error) {
    throw new Error(`Failed to perform double SHA256: ${error.message}`);
  }
}

/**
 * Checks if a hash is below the target difficulty
 * @param {Buffer} hashBE - The hash to check (in big-endian)
 * @param {string} targetHex - The target difficulty in hex
 * @returns {boolean} True if hash is below target, false otherwise
 */
function isHashBelowTarget(hashBE, targetHex) {
  try {
    const target = Buffer.from(targetHex, "hex");
    return hashBE.compare(target) < 0;
  } catch (error) {
    throw new Error(`Failed to compare hash with target: ${error.message}`);
  }
}

/**
 * Creates a complete mining header with nonce from config
 * @param {Object} cfg - Configuration object containing mining parameters
 * @param {number} nonce - The nonce to include in the header
 * @returns {Buffer} The complete header with nonce
 */
function createHeaderWithNonce(cfg, nonce) {
  try {
    const prefix = buildHeaderPrefix(cfg);
    return buildHeaderWithNonce(prefix, nonce);
  } catch (error) {
    throw new Error(`Failed to create header with nonce: ${error.message}`);
  }
}

/**
 * Calculates the final hash directly from configuration and nonce
 * @param {Object} cfg - Configuration object containing mining parameters
 * @param {number} nonce - The nonce to use for hashing
 * @returns {string} The final hash as a hex string
 */
function calculateHash(cfg, nonce) {
  try {
    const header = createHeaderWithNonce(cfg, nonce);
    const hash = doubleSHA256(header);
    return hash.toString('hex');
  } catch (error) {
    throw new Error(`Failed to calculate final hash: ${error.message}`);
  }
}

module.exports = {
  buildHeaderPrefix,
  buildHeaderWithNonce,
  doubleSHA256,
  isHashBelowTarget,
  createHeaderWithNonce,
  calculateHash,
};
