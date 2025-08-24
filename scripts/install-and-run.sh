#!/usr/bin/env bash
set -euo pipefail

# KBUC Miner installer & runner (Linux)
# Usage:
#   ./scripts/install-and-run.sh [--reinstall] [--clean] [--skip-dashboard-build] [--start-dashboard-dev] [--config-path=PATH] [--port-override=PORT]

REINSTALL=false
CLEAN=false
SKIP_DASHBOARD_BUILD=false
START_DASHBOARD_DEV=false
CONFIG_PATH="config/mining-config.json"
PORT_OVERRIDE=""

log_section() { echo -e "\n=== $* ==="; }
log_step()    { echo "[+] $*"; }
log_warn()    { echo "[!] $*"; }
log_err()     { echo "[x] $*" 1>&2; }

require_cmd() { command -v "$1" >/dev/null 2>&1 || { log_err "Required command '$1' not found in PATH"; exit 1; }; }

parse_args() {
  for arg in "$@"; do
    case "$arg" in
      --reinstall) REINSTALL=true ;;
      --clean) CLEAN=true ;;
      --skip-dashboard-build) SKIP_DASHBOARD_BUILD=true ;;
      --start-dashboard-dev) START_DASHBOARD_DEV=true ;;
      --config-path=*) CONFIG_PATH="${arg#*=}" ;;
      --port-override=*) PORT_OVERRIDE="${arg#*=}" ;;
      *) log_err "Unknown argument: $arg"; exit 1 ;;
    esac
  done
}

compare_node_semver() {
  # returns 0 if node >= $1 else 1
  node -e "const a=process.versions.node.split('.').map(Number), b='$1'.split('.').map(Number); function cmp(a,b){for(let i=0;i<3;i++){if((a[i]||0)>(b[i]||0)) return 1;if((a[i]||0)<(b[i]||0)) return -1;} return 0;} process.exit(cmp(a,b)>=0?0:1);"
}

ensure_node_npm() {
  log_section "Checking Node.js & npm"
  require_cmd node
  require_cmd npm
  local NODE_V
  NODE_V="$(node -p "process.versions.node")"
  log_step "Node.js version: $NODE_V"
  if ! compare_node_semver "16.0.0"; then
    log_err "Node.js >= 16.0.0 required. Installed: $NODE_V"
    exit 1
  fi
  local NPM_V
  NPM_V="$(npm -v)"
  log_step "npm version: $NPM_V"
}

install_dependencies() {
  local DIR="$1"
  pushd "$DIR" >/dev/null
  log_section "Installing dependencies in $DIR"
  if $CLEAN; then
    if [ -d node_modules ]; then log_warn "Removing node_modules"; rm -rf node_modules; fi
    if [ -f package-lock.json ]; then log_warn "Removing package-lock.json"; rm -f package-lock.json; fi
  fi
  if $REINSTALL && [ -d node_modules ]; then log_warn "Reinstall requested - removing node_modules"; rm -rf node_modules; fi

  if [ -f package-lock.json ]; then
    if ! npm ci --no-audit --fund false; then
      log_warn "npm ci failed. Retrying with --legacy-peer-deps"
      npm ci --no-audit --fund false --legacy-peer-deps
    fi
  else
    if ! npm install --no-audit --fund false; then
      log_warn "npm install failed. Retrying with --legacy-peer-deps"
      npm install --no-audit --fund false --legacy-peer-deps
    fi
  fi
  log_step "Dependencies installed in $DIR"
  popd >/dev/null
}

build_dashboard() {
  if $SKIP_DASHBOARD_BUILD; then log_warn "Skipping dashboard build per flag"; return; fi
  local DASH="$(dirname "$0")/../dashboard"
  if [ ! -f "$DASH/package.json" ]; then
    log_warn "Dashboard not found at $DASH. Skipping build."
    return
  fi
  install_dependencies "$DASH"
  log_section "Building dashboard"
  pushd "$DASH" >/dev/null
  npm run build
  popd >/dev/null
  log_step "Dashboard built successfully"
}

port_in_use() {
  local PORT="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -lnt | awk '{print $4}' | grep -E ":${PORT}$" >/dev/null 2>&1
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
  else
    # Fallback: try nc (netcat) zero-I/O test
    nc -z localhost "$PORT" >/dev/null 2>&1
  fi
}

find_free_port() {
  local START="$1"
  local P
  for (( P=START; P<65535; P++ )); do
    if ! port_in_use "$P"; then echo "$P"; return 0; fi
  done
  return 1
}

ensure_api_port_available() {
  log_section "Checking API port availability"
  local PORT
  if [ -n "$PORT_OVERRIDE" ]; then
    PORT="$PORT_OVERRIDE"
  else
    PORT="$(node - <<'NODE'
const fs=require('fs');
const path=require('path');
const cp=process.env.CONFIG_PATH||'config/mining-config.json';
const p=path.resolve(cp);
try{
  const j=JSON.parse(fs.readFileSync(p,'utf8'));
  const port=(j.network&&j.network.api&&j.network.api.port)||(j.api&&j.api.port)||8001;
  console.log(port);
} catch(e){ console.log('8001'); }
NODE
)"
  fi
  if port_in_use "$PORT"; then
    log_warn "Port $PORT is in use. Searching for a free port..."
    local FREE
    FREE="$(find_free_port $((PORT+1)) || true)"
    if [ -z "$FREE" ]; then log_err "No free port found above $PORT"; exit 1; fi
    log_warn "Using free port $FREE and updating config"
    node - <<'NODE'
const fs=require('fs');
const path=require('path');
const cp=process.env.CONFIG_PATH||'config/mining-config.json';
const p=path.resolve(cp);
const data=JSON.parse(fs.readFileSync(p,'utf8'));
if(!data.network) data.network={};
if(!data.network.api) data.network.api={};
const free=parseInt(process.env.FREE_PORT,10);
data.network.api.port=free;
if(data.api && typeof data.api==='object') data.api.port=free; // legacy sync
fs.writeFileSync(p, JSON.stringify(data,null,2));
console.log('UPDATED',p,'-> port',free);
NODE
    else
      export FREE_PORT="$FREE"
    fi
    echo "$FREE"
  else
    log_step "Port $PORT is available"
    echo "$PORT"
  fi
}

validate_config() {
  log_section "Validating configuration via ConfigManager"
  CONFIG_PATH="$CONFIG_PATH" node "scripts/validate-config.js" >/dev/null
  log_step "Configuration is valid"
}

start_miner() {
  log_section "Starting KBUC Miner"
  export CONFIG_PATH
  if $START_DASHBOARD_DEV; then
    local DASH="$(dirname "$0")/../dashboard"
    if [ -f "$DASH/package.json" ]; then
      log_warn "Starting Vite dev server for dashboard (port 5173) in background"
      ( cd "$DASH" && npm run dev -- --host >/dev/null 2>&1 & echo $! > ../.dashboard-dev.pid ) || log_warn "Failed to start dashboard dev server"
    else
      log_warn "Dashboard folder not found, skipping dev server"
    fi
  fi
  node src/main.js start
}

main() {
  parse_args "$@"
  ensure_node_npm
  install_dependencies "$(pwd)"
  build_dashboard
  export CONFIG_PATH
  local API_PORT
  API_PORT="$(ensure_api_port_available)"
  validate_config
  log_step "API will listen on port $API_PORT"
  start_miner
}

main "$@"
