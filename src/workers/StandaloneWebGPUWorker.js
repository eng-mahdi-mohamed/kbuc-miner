const {
  doubleSHA256,
  buildHeaderWithNonce,
  buildHeaderPrefix,
  isHashBelowTarget,
} = require("../utils/hashingUtils");
const fs = require("fs");

let shuttingDown = false; // global shutdown flag controlled by signals
process.on("unhandledRejection", (err) => {
  console.error("UnhandledRejection:", err?.stack || err);
});
process.on("uncaughtException", (err) => {
  console.error("UncaughtException:", err?.stack || err);
});

// Graceful shutdown handlers
process.on("SIGTERM", () => {
  console.warn("SIGTERM received: initiating graceful shutdown...");
  shuttingDown = true;
});
process.on("SIGINT", () => {
  console.warn("SIGINT received: initiating graceful shutdown...");
  shuttingDown = true;
});

// Structured logging helper (NDJSON)
const STRUCTURED = process.env.STRUCTURED_LOGS === "true";
function emit(type, data = {}) {
  if (!STRUCTURED) return;
  try {
    const evt = { type, ts: Date.now(), ...data };
    console.log(JSON.stringify(evt));
  } catch {}
}

// Fallback configuration (used if no external config is provided)
// Note: leader_address and block_height are intentionally omitted and MUST be provided.
const FALLBACK_CONFIG = {
  ticket_data:
    "0000000000000000000000000000000000000000000000000000000000000000",
  reward_address: "89d66c0a217e90f520ca156d22ead95994ba437a",
  mining_type: 1,
  timestamp: 1755491117,
  target_hex:
    "000000fffff00000000000000000000000000000000000000000000000000000",
  base_nonce: 0,
};

// Fixed maximum allowed nonce (32-bit unsigned max)
const MAX_NONCE = 0xffffffff;
// Enforce stopping when MAX_NONCE is reached
const STOP_AT_NONCE_LIMIT = true;

function validateConfig(cfg) {
  const missing = [];
  if (!cfg || typeof cfg !== "object") {
    throw new Error("Config is missing or invalid (expected object)");
  }
  // Required: leader_address (20-byte hex) and block_height (uint32)
  if (!cfg.leader_address) missing.push("leader_address");
  if (cfg.block_height === undefined || cfg.block_height === null)
    missing.push("block_height");
  if (missing.length) {
    throw new Error(`Missing required config fields: ${missing.join(", ")}`);
  }
  if (
    typeof cfg.leader_address !== "string" ||
    cfg.leader_address.length !== 40 ||
    /[^0-9a-fA-F]/.test(cfg.leader_address)
  ) {
    throw new Error("leader_address must be a 20-byte (40 hex chars) string");
  }
  const bh = parseInt(String(cfg.block_height), 10);
  if (!Number.isFinite(bh) || bh < 0) {
    throw new Error("block_height must be a non-negative integer");
  }
  cfg.block_height = bh >>> 0;
}

function parseCliArgs() {
  const args = process.argv.slice(2);
  const out = {};
  const takeVal = (i) => (i + 1 < args.length ? args[i + 1] : undefined);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("-")) continue;
    const [flag, valEq] = a.includes("=") ? a.split("=") : [a, undefined];
    const val = valEq !== undefined ? valEq : takeVal(i);
    switch (flag) {
      case "--leader":
      case "-L":
        out.leader_address = val;
        break;
      case "--block":
      case "-B":
        out.block_height = val;
        break;
      case "--reward":
      case "-R":
        out.reward_address = val;
        break;
      case "--target":
      case "-T":
        out.target_hex = val;
        break;
      case "--timestamp":
        out.timestamp = val;
        break;
      case "--type":
        out.mining_type = val;
        break;
      case "--ticket":
        out.ticket_data = val;
        break;
      case "--config":
        out.__configPath = val;
        break;
      case "--nonce":
      case "-n":
        out.base_nonce = val;
        break;
    }
  }
  return out;
}

function resolveConfig() {
  // Start from fallback
  let cfg = { ...FALLBACK_CONFIG };
  const cli = parseCliArgs();
  // Load from explicit CLI --config JSON if provided
  if (cli.__configPath) {
    try {
      const raw = fs.readFileSync(cli.__configPath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") cfg = { ...cfg, ...parsed };
    } catch (e) {
      console.warn("Failed to read --config file:", e?.message || e);
    }
  } else {
    // Else try env JSON, then env path
    try {
      if (process.env.MINER_CONFIG) {
        const parsed = JSON.parse(process.env.MINER_CONFIG);
        if (parsed && typeof parsed === "object") cfg = { ...cfg, ...parsed };
      } else if (process.env.MINER_CONFIG_PATH) {
        const raw = fs.readFileSync(process.env.MINER_CONFIG_PATH, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") cfg = { ...cfg, ...parsed };
      }
    } catch (e) {
      console.warn("Failed to read env config:", e?.message || e);
    }
  }
  // Finally, CLI individual fields override all
  const merges = [
    "leader_address",
    "block_height",
    "reward_address",
    "target_hex",
    "timestamp",
    "mining_type",
    "ticket_data",
    "base_nonce",
  ];
  for (const k of merges) {
    if (cli[k] !== undefined) cfg[k] = cli[k];
  }
  return { ...cfg, base_nonce: parseInt(`${cfg.base_nonce}`, 10) };
}

async function mining(cfg) {
  // Dynamically import ESM-only 'webgpu' from CommonJS context
  const { create, globals } = await import("webgpu");
  Object.assign(globalThis, globals);
  const navigator = { gpu: create([]) };
  // Validate required fields early
  validateConfig(cfg);
  let adapter = await navigator.gpu?.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) throw new Error("No WebGPU adapter");
  // Compute desired workgroup size from adapter limits and request device with appropriate limits
  let computedWg = 64;
  try {
    const al = adapter?.limits || {};
    const maxX = (al.maxComputeWorkgroupSizeX ?? 64) >>> 0;
    const maxInv = (al.maxComputeInvocationsPerWorkgroup ?? maxX) >>> 0;
    computedWg = Math.max(1, Math.min(1024, maxX, maxInv));
  } catch {}
  let device = await adapter.requestDevice({
    requiredLimits: {
      maxComputeWorkgroupSizeX: computedWg,
      maxComputeWorkgroupSizeY: 1,
      maxComputeWorkgroupSizeZ: 1,
      maxComputeInvocationsPerWorkgroup: computedWg,
    },
  });
  let deviceLost = false;
  // Prefer using queue.readBuffer when available to avoid mapAsync, which can
  // trigger assertion dialogs on Windows when callbacks are cancelled
  const useReadBuffer = typeof (adapter && adapter.device && adapter.device.queue && adapter.device.queue.readBuffer) === "function"
    ? true
    : typeof (globalThis?.GPUQueue && globalThis.GPUQueue.prototype?.readBuffer) === "function"
    ? true
    : typeof ( ( () => { try { return device?.queue?.readBuffer; } catch { return undefined; } } )() ) === "function";
  device.lost
    ?.then((info) => {
      console.warn("WebGPU device lost:", info?.reason || "(no reason)");
      deviceLost = true;
      emit("deviceLost", { reason: info?.reason || null, phase: "init" });
    })
    .catch((err) => {
      console.warn("device.lost promise rejected:", err?.message || err);
      deviceLost = true;
      emit("deviceLost", {
        reason: err?.message || String(err),
        phase: "init-reject",
      });
    });

  // Initialize baseNonce from cfg, then allow command line to override
  let baseNonce = 0;
  try {
    if (cfg && cfg.base_nonce != null) {
      const n = cfg.base_nonce;
      if (Number.isFinite(n)) baseNonce = n >>> 0;
    }
  } catch {}

  let count = 16384;
  const COUNT_MIN = 8192;
  const COUNT_MAX = 32768;
  let wgSize = computedWg;
  let dispatchX = Math.ceil(count / wgSize);

  const prefix = buildHeaderPrefix(cfg);

  let first64WordsBuf = null;
  let block2ConstWordsBuf = null;
  let targetWordsBuf = null;
  let resultsBuf = null;
  let resultsAligned = 0;
  let shader = null;
  let pipeline = null;
  let uniformBuf = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  let bindGroup = null;
  const pendingMapOps = new Set();

  const createShaderAndPipeline = () => {
    const msg = buildHeaderWithNonce(prefix, 0);
    const first64 = msg.subarray(0, 64);
    const tail24 = msg.subarray(64, 88);
    const first64Words = new Uint32Array(16);
    for (let i = 0; i < 16; i++) {
      const b0 = first64[i * 4 + 0];
      const b1 = first64[i * 4 + 1];
      const b2 = first64[i * 4 + 2];
      const b3 = first64[i * 4 + 3];
      first64Words[i] = ((b0 << 24) | (b1 << 16) | (b2 << 8) | (b3 << 0)) >>> 0;
    }
    const block2ConstWords = new Uint32Array(5);
    for (let i = 0; i < 5; i++) {
      const o = i * 4;
      const b0 = tail24[o + 0];
      const b1 = tail24[o + 1];
      const b2 = tail24[o + 2];
      const b3 = tail24[o + 3];
      block2ConstWords[i] =
        ((b0 << 24) | (b1 << 16) | (b2 << 8) | (b3 << 0)) >>> 0;
    }
    first64WordsBuf = device.createBuffer({
      size: first64Words.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(
      first64WordsBuf,
      0,
      first64Words.buffer,
      first64Words.byteOffset,
      first64Words.byteLength
    );
    block2ConstWordsBuf = device.createBuffer({
      size: block2ConstWords.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(
      block2ConstWordsBuf,
      0,
      block2ConstWords.buffer,
      block2ConstWords.byteOffset,
      block2ConstWords.byteLength
    );

    const targetBuf = Buffer.from(cfg.target_hex, "hex");
    const targetWords = new Uint32Array(8);
    for (let i = 0; i < 8; i++) {
      targetWords[i] = targetBuf.readUInt32BE(i * 4);
    }
    targetWordsBuf = device.createBuffer({
      size: targetWords.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(
      targetWordsBuf,
      0,
      targetWords.buffer,
      targetWords.byteOffset,
      targetWords.byteLength
    );

    const maxSols = 64;
    const resultsSize = 4 + 36 * maxSols;
    resultsAligned = (resultsSize + 255) & ~255;
    resultsBuf = device.createBuffer({
      size: resultsAligned,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    });

    shader = device.createShaderModule({
      code: `
          struct Uniforms { baseNonce: u32, count: u32, _pad0: u32, _pad1: u32 };
          @group(0) @binding(0) var<uniform> uni: Uniforms;
          @group(0) @binding(1) var<storage, read> first64: array<u32>;
          @group(0) @binding(2) var<storage, read> blk2c: array<u32>;
          struct Results { count: atomic<u32>, data: array<u32> };
          @group(0) @binding(3) var<storage, read_write> results: Results;
          @group(0) @binding(4) var<storage, read> tgt: array<u32,8>;
  
          fn rotr(x: u32, n: u32) -> u32 { return (x >> n) | (x << (32u - n)); }
          fn Ch(x: u32, y: u32, z: u32) -> u32 { return (x & y) ^ (~x & z); }
          fn Maj(x: u32, y: u32, z: u32) -> u32 { return (x & y) ^ (x & z) ^ (y & z); }
          fn Sigma0(x: u32) -> u32 { return rotr(x, 2u) ^ rotr(x, 13u) ^ rotr(x, 22u); }
          fn Sigma1(x: u32) -> u32 { return rotr(x, 6u) ^ rotr(x, 11u) ^ rotr(x, 25u); }
          fn sigma0(x: u32) -> u32 { return rotr(x, 7u) ^ rotr(x, 18u) ^ (x >> 3u); }
          fn sigma1(x: u32) -> u32 { return rotr(x, 17u) ^ rotr(x, 19u) ^ (x >> 10u); }
  
          const K: array<u32, 64> = array<u32,64>(
            0x428a2f98u,0x71374491u,0xb5c0fbcfu,0xe9b5dba5u,0x3956c25bu,0x59f111f1u,0x923f82a4u,0xab1c5ed5u,
            0xd807aa98u,0x12835b01u,0x243185beu,0x550c7dc3u,0x72be5d74u,0x80deb1feu,0x9bdc06a7u,0xc19bf174u,
            0xe49b69c1u,0xefbe4786u,0x0fc19dc6u,0x240ca1ccu,0x2de92c6fu,0x4a7484aau,0x5cb0a9dcu,0x76f988dau,
            0x983e5152u,0xa831c66du,0xb00327c8u,0xbf597fc7u,0xc6e00bf3u,0xd5a79147u,0x06ca6351u,0x14292967u,
            0x27b70a85u,0x2e1b2138u,0x4d2c6dfcu,0x53380d13u,0x650a7354u,0x766a0abbu,0x81c2c92eu,0x92722c85u,
            0xa2bfe8a1u,0xa81a664bu,0xc24b8b70u,0xc76c51a3u,0xd192e819u,0xd6990624u,0xf40e3585u,0x106aa070u,
            0x19a4c116u,0x1e376c08u,0x2748774cu,0x34b0bcb5u,0x391c0cb3u,0x4ed8aa4au,0x5b9cca4fu,0x682e6ff3u,
            0x748f82eeu,0x78a5636fu,0x84c87814u,0x8cc70208u,0x90befffau,0xa4506cebu,0xbef9a3f7u,0xc67178f2u);
  
          fn compress_rounds(state: ptr<function, array<u32,8>>, W: ptr<function, array<u32,64>>) {
            var a = (*state)[0]; var b = (*state)[1]; var c = (*state)[2]; var d = (*state)[3];
            var e = (*state)[4]; var f = (*state)[5]; var g = (*state)[6]; var h = (*state)[7];
            for (var t: u32 = 0u; t < 64u; t = t + 1u) {
              let T1 = h + Sigma1(e) + Ch(e,f,g) + K[t] + (*W)[t];
              let T2 = Sigma0(a) + Maj(a,b,c);
              h = g; g = f; f = e; e = d + T1;
              d = c; c = b; b = a; a = T1 + T2;
            }
            (*state)[0] = (*state)[0] + a; (*state)[1] = (*state)[1] + b; (*state)[2] = (*state)[2] + c; (*state)[3] = (*state)[3] + d;
            (*state)[4] = (*state)[4] + e; (*state)[5] = (*state)[5] + f; (*state)[6] = (*state)[6] + g; (*state)[7] = (*state)[7] + h;
          }
  
          // Byte-swap a 32-bit word (preserves existing endianness behavior)
          fn bswap32(x: u32) -> u32 {
              return ((x & 0x000000FFu) << 24u) |
                     ((x & 0x0000FF00u) << 8u)  |
                     ((x & 0x00FF0000u) >> 8u)  |
                     ((x & 0xFF000000u) >> 24u);
          }

          // Compare hash against target without allocating a temp array
          fn is_below_target(h: array<u32,8>) -> bool {
              for (var i: u32 = 0u; i < 8u; i = i + 1u) {
                  let hv = bswap32(h[7u - i]); // match previous reversed order + byte-swap
                  let tv = tgt[i];
                  if (hv < tv) { return true; }
                  if (hv > tv) { return false; }
              }
              return false;
          }
  
          @compute @workgroup_size(${wgSize}, 1, 1)
          fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
            let idx = gid.x;
            if (idx >= uni.count) { return; }
            let nonce = uni.baseNonce + idx;
            let nBE = ((nonce & 0x000000FFu) << 24u) | ((nonce & 0x0000FF00u) << 8u) | ((nonce & 0x00FF0000u) >> 8u) | ((nonce & 0xFF000000u) >> 24u);
  
            var H = array<u32,8>(
              0x6a09e667u,0xbb67ae85u,0x3c6ef372u,0xa54ff53au,0x510e527fu,0x9b05688cu,0x1f83d9abu,0x5be0cd19u);
  
            var W1 = array<u32,64>();
            for (var i:u32=0u; i<16u; i=i+1u) { W1[i] = first64[i]; }
            for (var t:u32=16u; t<64u; t=t+1u) { W1[t] = sigma1(W1[t-2u]) + W1[t-7u] + sigma0(W1[t-15u]) + W1[t-16u]; }
            compress_rounds(&H, &W1);
  
            var W2 = array<u32,64>();
            W2[0] = blk2c[0]; W2[1] = blk2c[1]; W2[2] = blk2c[2]; W2[3] = blk2c[3]; W2[4] = blk2c[4];
            W2[5] = nBE; W2[6] = 0x80000000u; W2[15] = 704u;
            for (var t:u32=16u; t<64u; t=t+1u) { W2[t] = sigma1(W2[t-2u]) + W2[t-7u] + sigma0(W2[t-15u]) + W2[t-16u]; }
            compress_rounds(&H, &W2);
  
            var H_final = array<u32,8>(
              0x6a09e667u,0xbb67ae85u,0x3c6ef372u,0xa54ff53au,0x510e527fu,0x9b05688cu,0x1f83d9abu,0x5be0cd19u);
            var W_final = array<u32,64>();
            for (var i:u32=0u; i<8u; i=i+1u) { W_final[i] = H[i]; }
            W_final[8] = 0x80000000u; W_final[15] = 256u;
            for (var t:u32=16u; t<64u; t=t+1u) { W_final[t] = sigma1(W_final[t-2u]) + W_final[t-7u] + sigma0(W_final[t-15u]) + W_final[t-16u]; }
            compress_rounds(&H_final, &W_final);
  
            if (is_below_target(H_final)) {
              let slot = atomicAdd(&results.count, 1u);
              let base = slot * 9u;
              results.data[base] = nonce;
              for (var j:u32=0u; j<8u; j=j+1u) {
                results.data[base + 1u + j] = H_final[j];
              }
            }
          }
        `,
    });

    pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module: shader, entryPoint: "main" },
    });

    bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuf } },
        { binding: 1, resource: { buffer: first64WordsBuf } },
        { binding: 2, resource: { buffer: block2ConstWordsBuf } },
        { binding: 3, resource: { buffer: resultsBuf } },
        { binding: 4, resource: { buffer: targetWordsBuf } },
      ],
    });
  };

  // Adapt workgroup size based on device limits if available
  try {
    const limits = adapter?.limits || {};
    const maxX = (limits.maxComputeWorkgroupSizeX ?? 256) >>> 0;
    const maxInv = (limits.maxComputeInvocationsPerWorkgroup ?? maxX) >>> 0;
    const chosen = Math.min(1024, maxX, maxInv);
    if (Number.isFinite(chosen) && chosen > 0) {
      if (chosen !== wgSize) {
        wgSize = chosen;
      }
      dispatchX = Math.ceil(count / wgSize);
      console.log(
        `[WebGPU] workgroup_size=${wgSize}, maxX=${maxX}, maxInv=${maxInv}`
      );
    }
  } catch (e) {
    console.warn("Failed to read adapter limits:", e?.message || e);
  }

  createShaderAndPipeline();
  // Emit readiness both human-readable and structured
  console.log(`[READY] WebGPU initialized (wg=${wgSize}, count=${count})`);
  emit("ready", { wg: wgSize, count });

  let readback = null;
  if (!useReadBuffer) {
    readback = device.createBuffer({
      size: resultsAligned,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
  }
  let currentBase = baseNonce >>> 0;
  let processedTotal = 0;
  let totalMatches = 0;
  let loopCount = 0;
  let stableIters = 0;
  const startedAt = Date.now();

  // console.log("🔧 WebGPU compute probe");
  // console.log("- batch count:", count);

  let passErrorStreak = 0;
  while (true) {
    if (shuttingDown) {
      console.log("\n👋 Shutdown requested; cleaning up and exiting loop...");
      break;
    }
    let mapped = false;
    let needReinit = false;
    let mapPromise = null;
    // Per-iteration effective batch parameters
    let batchCount = count;
    let batchDispatchX = dispatchX;
    let hitLimit = false;
    try {
      // Enforce max nonce limit (avoid crossing and stop exactly on limit)
      if (STOP_AT_NONCE_LIMIT) {
        const remaining = MAX_NONCE - currentBase + 1; // remaining nonces including currentBase
        if (remaining <= 0) {
          console.log("✅ Reached max nonce limit; stopping.");
          break;
        }
        batchCount = Math.min(count, remaining);
        batchDispatchX = Math.ceil(batchCount / wgSize);
        hitLimit = batchCount === remaining;
      }
      const uniArray = new Uint32Array([
        currentBase >>> 0,
        batchCount >>> 0,
        0,
        0,
      ]);
      device.queue.writeBuffer(
        uniformBuf,
        0,
        uniArray.buffer,
        uniArray.byteOffset,
        uniArray.byteLength
      );
      device.queue.writeBuffer(resultsBuf, 0, new Uint32Array([0]).buffer);

      const t0 = performance.now();
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(batchDispatchX);
      pass.end();
      if (!useReadBuffer) {
        encoder.copyBufferToBuffer(resultsBuf, 0, readback, 0, resultsAligned);
      }
      device.queue.submit([encoder.finish()]);

      if (device.queue.onSubmittedWorkDone) {
        await device.queue.onSubmittedWorkDone();
      }

      let view;
      if (useReadBuffer) {
        const arrBuf = await device.queue.readBuffer(resultsBuf, 0, resultsAligned);
        view = new Uint32Array(arrBuf);
      } else {
        await readback.mapAsync(GPUMapMode.READ);
        mapped = true;
        view = new Uint32Array(readback.getMappedRange());
      }
      const dt = performance.now() - t0;

      // console.log(`- baseNonce: ${currentBase}`);
      const solCount = view[0] >>> 0;
      // console.log('- solutions found:', solCount);
      for (let i = 0; i < solCount; i++) {
        const base = i * 9 + 1; // Adjust for count field
        const nonce = view[base] >>> 0;
        const hash = Buffer.alloc(32);
        for (let j = 0; j < 8; j++) {
          const word = view[base + 1 + j] >>> 0;
          hash.writeUInt32BE(word, j * 4);
        }
        // Verify solution
        const msg = buildHeaderWithNonce(prefix, nonce);
        const hh = doubleSHA256(msg);
        if (isHashBelowTarget(hh, cfg.target_hex)) {
          if (STRUCTURED) {
            // Structured solution event
            emit("solution", {
              nonce,
              hash: hh.toString("hex"),
              header: msg.toString("hex"),
            });
          } else {
            console.log(
              `✅ Verified: nonce=${nonce} hash=${hh.toString("hex")}`
            );
          }
        } else {
          console.error(
            `❌ Invalid: nonce=${nonce} hash=${hh.toString("hex")}`
          );
        }
      }
      if (processedTotal / 1000000 >= loopCount) {
        const overallDt = (Date.now() - startedAt) / 1000;
        // const elapsedStr = overallDt > 60 ? `${(overallDt / 60).toFixed(2)}m` : `${overallDt}s`;
        // Save last nonce to environment for resuming
        if (!STRUCTURED) {
          process.stdout.write(
            `\r🔎 Total hash: ${
              processedTotal + batchCount
            } |  nonce: ${currentBase + batchCount} | Hashrate: ${(
              batchCount /
              1000 /
              dt
            ).toFixed(2)} MH/s | Avg Hashrate: ${(
              processedTotal /
              1000 /
              (Date.now() - startedAt)
            ).toFixed(2)} MH/s | Elapsed: ${overallDt.toFixed(2)}\n`
          );
        }
        // Structured metrics event
        emit("metrics", {
          lastNonce: currentBase + batchCount,
          totalHashes: processedTotal + batchCount,
          totalMatches: totalMatches + solCount,
          rate: (batchCount * 1000) / dt,
          avgRate:
            processedTotal > 0
              ? (processedTotal * 1000) / (Date.now() - startedAt)
              : 0,
          elapsedSec: overallDt,
        });
        loopCount++;
      }
      totalMatches += solCount;
      if (!useReadBuffer) {
        try {
          readback.unmap();
        } catch (e) {
          console.warn("Unmap (post-read) failed:", e?.message || e);
        }
        mapped = false;
      }

      processedTotal += batchCount;
      currentBase = (currentBase + batchCount) >>> 0;
      if (hitLimit) {
        console.log("✅ Reached max nonce limit; stopping.");
        break;
      }
      passErrorStreak = 0;
      // adaptively increase batch size after stable iterations
      stableIters++;
      if (stableIters % 20 === 0 && count < COUNT_MAX) {
        const old = count;
        count = Math.min(COUNT_MAX, count + 4096);
        if (count !== old) {
          dispatchX = Math.ceil(count / wgSize);
          console.log(
            `[WebGPU] Increasing batch count to ${count} after stable iterations`
          );
        }
      }
    } catch (err) {
      console.warn("Pass-level error:", err?.stack || err);
      passErrorStreak++;
      if (deviceLost || passErrorStreak >= 2) {
        needReinit = true;
      }
      // reduce batch size on repeated errors
      const newCount = Math.max(COUNT_MIN, Math.floor(count / 2));
      if (newCount !== count) {
        count = newCount;
        dispatchX = Math.ceil(count / wgSize);
        console.warn(`[WebGPU] Reduced batch count to ${count} due to errors`);
      }
      stableIters = 0;
      processedTotal += batchCount;
      currentBase = (currentBase + batchCount) >>> 0;
      if (hitLimit) {
        console.log("✅ Reached max nonce limit; stopping.");
        break;
      }
      continue;
    } finally {
      if (mapped && !useReadBuffer) {
        try {
          readback.unmap();
        } catch (e) {
          console.warn("Unmap in finally failed:", e?.message || e);
        }
        mapped = false;
      }
      if (needReinit) {
        try {
          uniformBuf?.destroy();
          resultsBuf?.destroy();
          first64WordsBuf?.destroy();
          block2ConstWordsBuf?.destroy();
          targetWordsBuf?.destroy();
          readback?.destroy();

          const navigator2 = { gpu: create([]) };
          adapter = await navigator2.gpu?.requestAdapter({
            powerPreference: "high-performance",
          });
          if (!adapter) throw new Error("No WebGPU adapter on reinit");
          // Recompute wg size/limits and recreate device with required limits
          try {
            const al2 = adapter?.limits || {};
            const maxX2 = (al2.maxComputeWorkgroupSizeX ?? 64) >>> 0;
            const maxInv2 =
              (al2.maxComputeInvocationsPerWorkgroup ?? maxX2) >>> 0;
            const computedWg2 = Math.max(1, Math.min(1024, maxX2, maxInv2));
            device = await adapter.requestDevice({
              requiredLimits: {
                maxComputeWorkgroupSizeX: computedWg2,
                maxComputeWorkgroupSizeY: 1,
                maxComputeWorkgroupSizeZ: 1,
                maxComputeInvocationsPerWorkgroup: computedWg2,
              },
            });
            wgSize = computedWg2;
            dispatchX = Math.ceil(count / wgSize);
          } catch (devErr) {
            console.warn(
              "requestDevice with limits failed, falling back:",
              devErr?.message || devErr
            );
            device = await adapter.requestDevice({});
          }
          deviceLost = false;
          device.lost
            ?.then((info) => {
              console.warn(
                "WebGPU device lost (after reinit):",
                info?.reason || "(no reason)"
              );
              deviceLost = true;
            })
            .catch((err) => {
              console.warn(
                "device.lost promise rejected (after reinit):",
                err?.message || err
              );
              deviceLost = true;
            });

          uniformBuf = device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          });
          createShaderAndPipeline();
          if (!useReadBuffer) {
            readback = device.createBuffer({
              size: resultsAligned,
              usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
            });
          }
          console.warn("Reinit complete. Resuming mining...");
          passErrorStreak = 0;
        } catch (reErr) {
          console.error("Reinit failed:", reErr?.stack || reErr);
        } finally {
          needReinit = false;
        }
      }
    }
  }
  // Final cleanup on loop exit (e.g., shutdown request)
  try {
    try {
      readback?.unmap();
    } catch {}
    try {
      readback?.destroy();
    } catch {}
    try {
      uniformBuf?.destroy();
    } catch {}
    try {
      resultsBuf?.destroy();
    } catch {}
    try {
      first64WordsBuf?.destroy();
    } catch {}
    try {
      block2ConstWordsBuf?.destroy();
    } catch {}
    try {
      targetWordsBuf?.destroy();
    } catch {}
  } catch {}
}
// Run WebGPU miner if flag is present
(async () => {
  try {
    await mining(resolveConfig());
    console.log("Mining completed successfully");
    if (shuttingDown) {
      // Ensure clean exit when we were asked to stop
      process.exit(0);
    } else if (process.env.KEEP_ALIVE === "true") {
      // Stay alive only if explicitly requested
    } else {
      process.exit(0);
    }
  } catch (e) {
    if (shuttingDown) {
      console.log("Mining stopped by shutdown signal");
      process.exit(0);
    } else {
      console.error("WGPU miner error:", e);
      process.exit(1);
    }
  }
})();

// Keep the process running only if requested
if (process.env.KEEP_ALIVE === "true") {
  process.stdin.resume();
}
