const path = require('path');
const ConfigManager = require('../src/core/ConfigManager');

(async () => {
  try {
    if (!process.env.CONFIG_PATH) {
      process.env.CONFIG_PATH = 'config/mining-config.json';
    }
    const cfg = new ConfigManager();
    await cfg.load();
    console.log('OK');
    process.exit(0);
  } catch (e) {
    console.error('CONFIG_ERROR:', e && e.message ? e.message : e);
    process.exit(2);
  }
})();
