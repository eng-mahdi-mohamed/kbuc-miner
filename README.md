# KBUC Mining System (kbuc-miner)

Modern, flexible mining system supporting CPU and GPU (WebGPU) with a REST API, real-time WebSocket streaming, and a Vite + Vue dashboard. Works on Windows and Linux with installer/runner scripts, CORS and API key security, monitoring, and auto-restart controls.

## Key Features
- __Multi-engine mining__: `engines.gpu` (WebGPU with safeguards & recovery) and `engines.cpu`.
- __Web server + REST API__: system/mining stats, start/stop/pause/resume, and live config updates.
- __WebSocket streaming__: periodic broadcasts of stats and health via `ws://host:port/api/ws`.
- __Dashboard__: Vite-built UI automatically served from `dashboard/dist/` in production.
- __Cross-platform scripts__: Windows PowerShell and Linux Bash for quick install/run with auto port resolution.
- __Security & controls__: CORS, rate limiting, optional API key via `security.authentication.apiKey`.

## Requirements
- __Node.js >= 16__ and npm.
- Windows 10/11 or a modern Linux distribution.
- WebGPU-capable GPU (optional). Falls back to CPU automatically if unavailable.

## Quickstart
- __Windows (double-click)__: run `run-miner.cmd` in the project root.
- __Windows (PowerShell)__:
  ```powershell
  .\scripts\install-and-run.ps1 -StartDashboardDev -ConfigPath "config/mining-config.json"
  ```
- __Linux__:
  ```bash
  ./run-miner.sh --start-dashboard-dev --config-path=config/mining-config.json
  ```

What the installer scripts do:
- Install dependencies in the root and `dashboard/`.
- Build the dashboard (can be skipped via flags).
- Validate configuration via `scripts/validate-config.js` and `ConfigManager`.
- Resolve API port conflicts by updating `network.api.port` and syncing legacy `api.port` when present.

## Script Options
- __Windows__ `scripts/install-and-run.ps1`:
  - `-Reinstall` Reinstall packages (remove node_modules).
  - `-Clean` Full clean (node_modules + package-lock.json).
  - `-SkipDashboardBuild` Skip dashboard build.
  - `-StartDashboardDev` Start Vite dev server on `5173` in the background.
  - `-ConfigPath <path>` Config file path (default: `config/mining-config.json`).
  - `-PortOverride <port>` Force API port.
- __Linux__ `scripts/install-and-run.sh`:
  - `--reinstall`, `--clean`, `--skip-dashboard-build`, `--start-dashboard-dev`
  - `--config-path=PATH`, `--port-override=PORT`

## Manual Run (without scripts)
- From project root:
  ```bash
  npm install
  npm start            # equals: node src/main.js
  # Development mode:
  npm run dev          # nodemon src/main.js dev
  ```
- Run dashboard in development:
  ```bash
  cd dashboard && npm install && npm run dev -- --host
  ```

## Project Structure (high level)
- `src/main.js`: entry point + CLI (`dev|status|config`).
- `src/core/WebServer.js`: web server, REST API, WebSocket.
- `src/core/MiningSystem.js`: start/stop/pause/resume mining and stats.
- `src/core/ConfigManager.js`: config loading and validation.
- `scripts/install-and-run.ps1` and `scripts/install-and-run.sh`: install/build/run automation and port resolution.
- `config/mining-config.json`: default config (see below).
- `dashboard/`: frontend (Vite + Vue). `dashboard/dist/` is served automatically in production.

## Configuration `config/mining-config.json`
Clean, reorganized structure. Frequently used sections:
- `system`: general info.
- `network.api`: `host`, `port`, `timeout`, `retryAttempts`, `retryDelay`.
- `mining.blockchain`: `defaultTicketData`, `defaultRewardAddress`, `defaultDifficultyTarget`, `defaultMiningType`.
- `mining.session`: `maxTimeSeconds`, `timeout`, `maxSolutionsPerSession`, `continueAfterSolution`.
- `mining.restart`: `autoRestart`, `delaySeconds`, `maxAttempts`.
- `engines.gpu` and `engines.cpu`: enable and performance options.
- `performance`: `workers.maxCount`, `updateInterval`, ...
- `monitoring`: `enabled`, `interval`, and alert thresholds.
- `logging`: log level and rotation.
- `storage`: data and backup paths.
- `security`:
  - `cors.enabled` and `cors.origins` (include `http://localhost:5173` for Vite dev).
  - `authentication.apiKey` to enable API key protection.

Example quick override:
```json
{
  "network": { "api": { "host": "localhost", "port": 8001 } },
  "engines": { "gpu": { "enabled": true }, "cpu": { "enabled": true } },
  "security": { "authentication": { "enabled": false, "apiKey": "" } }
}
```

> Note: You can provide the config path via `CONFIG_PATH` env var or CLI: `node src/main.js start -c path/to/config.json`.

## REST API (from `src/core/WebServer.js`)
Server runs at `http://<host>:<port>` per `network.api`.
- `GET /health` — health check.
- `GET /api/system/info` — system information.
- `GET /api/mining/status` — mining status.
- `POST /api/mining/start` — start mining (409 if already running).
- `POST /api/mining/stop` — stop mining (requires `sessionId` in body).
- `POST /api/mining/restart` — restart with `{ reason, force }`.
- `POST /api/mining/pause` / `POST /api/mining/resume` — pause/resume session.
- `GET /api/mining/health` — mining system health.
- `POST /api/mining/test-mode` — `{ enabled, timeoutSeconds }`.
- `GET /api/mining/stats` — statistics.
- `GET /api/config` and `PUT /api/config` — read/update config.
- `GET /api/logs` and `GET /api/alerts` — sample logs/alerts.
- `GET /api/dashboard` — dashboard data.
- `POST /mine/broadcast` — broadcast solution to the network.

If `security.authentication.apiKey` is enabled, send `x-api-key` header or `?apiKey=` query.

Quick examples:
```bash
# Health check
curl http://localhost:8001/health

# Start mining
curl -X POST http://localhost:8001/api/mining/start -H 'Content-Type: application/json' -d '{}'

# Stop mining
curl -X POST http://localhost:8001/api/mining/stop -H 'Content-Type: application/json' \
     -d '{"sessionId":"<current-session-id>"}'

# Broadcast solution
curl -X POST http://localhost:8001/mine/broadcast -H 'Content-Type: application/json' \
  -d '{
    "nonce": 12345,
    "hash": "0xabc...",
    "ticket_data": "000...000",
    "leader_address": "...",
    "reward_address": "...",
    "block_height": 100,
    "mining_type": 1,
    "timestamp": 1730000000
  }'
```

__WebSocket__:
- Endpoint: `ws://localhost:8001/api/ws`
- Auth: `x-api-key` header or `?apiKey=...` when enabled.
- Message types: `ready`, `stats` (every 1s), `health` (every 5s).

## Development Tips
- Root:
  - `npm start` to run the system.
  - `npm run dev` to run with nodemon.
- Frontend:
  - `dashboard/`: `npm run dev` (Vite on 5173) and `npm run build` for production.
- CORS allows `http://localhost:5173` and `http://127.0.0.1:5173` for development.

## Troubleshooting
- __Port 8001 in use__: installer scripts bump `network.api.port` and sync `api.port` if present.
- __Old Node version__: upgrade to Node >= 16.
- __No supported GPU__: system automatically runs on CPU.
- __401 Unauthorized__: enable `security.authentication.apiKey` and send correct `x-api-key`.

## License
MIT — see `license` in `package.json`.

---

## 🇸🇦 النسخة العربية

منظومة تعدين ذكية ومرنة تدعم CPU وGPU (WebGPU) مع واجهة API ولوحة مراقبة حديثة (Vite + Vue). مُهيأة للعمل على Windows وLinux، وتتضمن أدوات تثبيت وتشغيل تلقائي، وحماية عبر CORS ومفاتيح API، ومراقبة وأتمتة إعادة التشغيل.


## الميزات الرئيسية
- __تعدين متعدد المحركات__: `engines.gpu` (WebGPU مع آليات حماية واستعادة) و`engines.cpu`.
- __خادم ويب وREST API__: تقديم إحصائيات النظام والتعدين، التحكم في التشغيل/الإيقاف/الإيقاف المؤقت/الاستئناف، ضبط الإعدادات أثناء التشغيل.
- __WebSocket للبث الحي__: بث دوري للإحصائيات والصحة عبر `ws://host:port/api/ws`.
- __لوحة مراقبة Dashboard__: واجهة أمامية حديثة تُبنى بـ Vite وتُخدم تلقائياً عند البناء.
- __توافق متعدد الأنظمة__: سكربتات Windows PowerShell وLinux Bash للتثبيت والتشغيل السريع مع حل تلقائي لتضارب المنافذ.
- __ضبط وأمان__: CORS، Rate Limiting، ومفتاح API اختياري عبر `security.authentication.apiKey`.


## المتطلبات
- __Node.js >= 16__ وnpm.
- نظام تشغيل Windows 10/11 أو توزيعة Linux حديثة.
- بطاقة رسومية تدعم WebGPU (اختياري). النظام يسقط تلقائياً إلى CPU عند عدم توفر GPU.


## البدء السريع
- __Windows (نقرة مزدوجة)__: شغّل `run-miner.cmd` في جذر المشروع.
- __Windows (PowerShell)__:
  ```powershell
  .\scripts\install-and-run.ps1 -StartDashboardDev -ConfigPath "config/mining-config.json"
  ```
- __Linux__:
  ```bash
  ./run-miner.sh --start-dashboard-dev --config-path=config/mining-config.json
  ```

سكربتات التثبيت تقوم بـ:
- تثبيت الاعتمادات في الجذر و`dashboard/`.
- بناء لوحة المراقبة (يمكن تخطيه عبر الخيار أدناه).
- التحقق من التهيئة عبر `scripts/validate-config.js` و`ConfigManager`.
- حل تضارب منفذ الـ API تلقائياً بتعديل `network.api.port` ومزامنة الحقل القديم `api.port` عند الحاجة.


## خيارات السكربتات
- __Windows__ `scripts/install-and-run.ps1`:
  - `-Reinstall` إعادة تثبيت الحزم (حذف node_modules).
  - `-Clean` تنظيف شامل (node_modules + package-lock.json).
  - `-SkipDashboardBuild` تخطي بناء اللوحة.
  - `-StartDashboardDev` تشغيل Vite Dev Server على `5173` في الخلفية.
  - `-ConfigPath <path>` مسار ملف الإعدادات (افتراضي: `config/mining-config.json`).
  - `-PortOverride <port>` فرض منفذ API.
- __Linux__ `scripts/install-and-run.sh`:
  - `--reinstall`, `--clean`, `--skip-dashboard-build`, `--start-dashboard-dev`
  - `--config-path=PATH`, `--port-override=PORT`


## تشغيل يدوي دون السكربتات
- من الجذر:
  ```bash
  npm install
  npm start            # تعادل: node src/main.js start
  # أو وضع التطوير:
  npm run dev          # nodemon src/main.js
  ```
- تشغيل لوحة المراقبة أثناء التطوير:
  ```bash
  cd dashboard && npm install && npm run dev -- --host
  ```


## البنية الأساسية للملفات
- `src/main.js`: نقطة الدخول وCLI (`start|status|config`).
- `src/core/WebServer.js`: خادم الويب وREST API وWebSocket.
- `src/core/MiningSystem.js`: منطق تشغيل/إيقاف/استئناف التعدين وإحصاءاته.
- `src/core/ConfigManager.js`: تحميل الإعدادات والتحقق منها.
- `scripts/install-and-run.ps1` و`scripts/install-and-run.sh`: تثبيت/بناء/تشغيل تلقائي وحل المنافذ.
- `config/mining-config.json`: الإعدادات الافتراضية (انظر أدناه).
- `dashboard/`: كود الواجهة (Vite + Vue). يتم تقديم `dashboard/dist/` تلقائياً في الإنتاج.


## ملف الإعدادات `config/mining-config.json`
هيكل حديث ومنظّم. أهم الأقسام المستخدمة فعلياً:
- `system`: معلومات عامة.
- `network.api`: `host`, `port`, `timeout`, `retryAttempts`, `retryDelay`.
- `mining.blockchain`: `defaultTicketData`, `defaultRewardAddress`, `defaultDifficultyTarget`, `defaultMiningType`.
- `mining.session`: `maxTimeSeconds`, `timeout`, `maxSolutionsPerSession`, `continueAfterSolution`.
- `mining.restart`: `autoRestart`, `delaySeconds`, `maxAttempts`.
- `engines.gpu` و`engines.cpu`: تفعيل/خيارات الأداء.
- `performance`: `workers.maxCount`, `updateInterval`, ...
- `monitoring`: `enabled`, `interval`, وعتبات التنبيهات.
- `logging`: مستوى وتدوير السجلات.
- `storage`: مسارات البيانات والنسخ الاحتياطية.
- `security`: 
  - `cors.enabled` و`cors.origins` (مصفوفة تتضمن `http://localhost:5173` لاستخدام Vite أثناء التطوير).
  - `authentication.apiKey` لتفعيل الحماية بمفتاح API.

مثال مبسّط للتعديل السريع:
```json
{
  "network": { "api": { "host": "localhost", "port": 8001 } },
  "engines": { "gpu": { "enabled": true }, "cpu": { "enabled": true } },
  "security": { "authentication": { "enabled": false, "apiKey": "" } }
}
```

> ملاحظة: يمكن تحديد مسار الإعدادات عبر المتغير البيئي `CONFIG_PATH` أو عبر CLI: `node src/main.js -c path/to/config.json`.


## REST API المختصرة
الخادم يعمل على `http://<host>:<port>` بحسب `network.api`. أهم النقاط من `src/core/WebServer.js`:
- `GET /health` — فحص الصحة.
- `GET /api/system/info` — معلومات النظام.
- `GET /api/mining/status` — حالة التعدين.
- `POST /api/mining/start` — بدء التعدين (يرفض إذا كان قيد التشغيل).
- `POST /api/mining/stop` — إيقاف (يتطلب `sessionId` في الجسم).
- `POST /api/mining/restart` — إعادة تشغيل مع `{ reason, force }`.
- `POST /api/mining/pause` / `POST /api/mining/resume` — إيقاف/استئناف جلسة.
- `GET /api/mining/health` — صحة المنظومة.
- `POST /api/mining/test-mode` — `{ enabled, timeoutSeconds }`.
- `GET /api/mining/stats` — إحصاءات.
- `GET /api/config` و`PUT /api/config` — قراءة/تحديث الإعدادات.
- `GET /api/logs` و`GET /api/alerts` — سجلات وتنبيهات (نماذج).
- `GET /api/dashboard` — بيانات لوحة المراقبة.
- `POST /mine/broadcast` — بث حل إلى الشبكة.

إذا كان `security.authentication.apiKey` مفعّلاً، أرسل رأس `x-api-key` أو استعلام `?apiKey=`.

أمثلة سريعة:
```bash
# فحص الصحة
curl http://localhost:8001/health

# بدء التعدين
curl -X POST http://localhost:8001/api/mining/start -H 'Content-Type: application/json' -d '{}'

# إيقاف التعدين
curl -X POST http://localhost:8001/api/mining/stop -H 'Content-Type: application/json' \
     -d '{"sessionId":"<current-session-id>"}'

# بث حل
curl -X POST http://localhost:8001/mine/broadcast -H 'Content-Type: application/json' \
  -d '{
    "nonce": 12345,
    "hash": "0xabc...",
    "ticket_data": "000...000",
    "leader_address": "...",
    "reward_address": "...",
    "block_height": 100,
    "mining_type": 1,
    "timestamp": 1730000000
  }'
```

__WebSocket__:
- العنوان: `ws://localhost:8001/api/ws`
- المصادقة: `x-api-key` كرأس أو `?apiKey=...` عند التفعيل.
- أنواع الرسائل: `ready`, `stats` (كل 1s), `health` (كل 5s).


## نصائح التطوير
- الجذر:
  - `npm start` لتشغيل النظام.
  - `npm run dev` لتشغيله مع nodemon.
- الواجهة:
  - `dashboard/`: `npm run dev` (Vite على 5173) و`npm run build` للإنتاج.
- CORS مُعدّ للسماح بـ `http://localhost:5173` و`http://127.0.0.1:5173` أثناء التطوير.


## استكشاف الأخطاء الشائعة
- __منفذ 8001 مشغول__: سكربتات التثبيت تُحدث `network.api.port` تلقائياً وتزامن `api.port` إن وُجد.
- __Node قديم__: حدّث إلى الإصدار 16 أو أحدث.
- __لا توجد GPU مدعومة__: سيعمل النظام على CPU تلقائياً.
- __401 Unauthorized__: فعّل `security.authentication.apiKey` وأرسل `x-api-key` صحيحاً.


## الترخيص
MIT — راجع الحقل `license` في `package.json`.
