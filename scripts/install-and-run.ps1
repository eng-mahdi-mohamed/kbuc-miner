Param(
    [switch]$Reinstall,
    [switch]$Clean,
    [switch]$SkipDashboardBuild,
    [switch]$StartDashboardDev,
    [string]$ConfigPath = "config/mining-config.json",
    [int]$PortOverride
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Section($Text) { Write-Host "`n=== $Text ===" -ForegroundColor Cyan }
function Write-Step($Text)    { Write-Host "[+] $Text" -ForegroundColor Green }
function Write-Warn($Text)    { Write-Host "[!] $Text" -ForegroundColor Yellow }
function Write-Err($Text)     { Write-Host "[x] $Text" -ForegroundColor Red }

function Require-Command($Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' not found in PATH. Please install it."
    }
}

function Get-NodeVersion() {
    try {
        $v = (& node -v).Trim().TrimStart('v')
        return $v
    } catch { return $null }
}

function Compare-Semver($a, $b) {
    $pa = $a.Split('.') | ForEach-Object { [int]$_ }
    $pb = $b.Split('.') | ForEach-Object { [int]$_ }
    for ($i=0; $i -lt [Math]::Max($pa.Count, $pb.Count); $i++) {
        $x = ($(if ($i -lt $pa.Count) { $pa[$i] } else { 0 }))
        $y = ($(if ($i -lt $pb.Count) { $pb[$i] } else { 0 }))
        if ($x -gt $y) { return 1 }
        if ($x -lt $y) { return -1 }
    }
    return 0
}

function Ensure-NodeNpm() {
    Write-Section "Checking Node.js & npm"
    Require-Command node
    Require-Command npm

    $nodeV = Get-NodeVersion
    if (-not $nodeV) { throw "Failed to read Node.js version" }
    Write-Step "Node.js version: $nodeV"
    if ((Compare-Semver $nodeV '16.0.0') -lt 0) {
        throw "Node.js >= 16.0.0 required. Installed: $nodeV. Download: https://nodejs.org/en/download"
    }

    $npmV = (& npm -v).Trim()
    Write-Step "npm version: $npmV"
}

function Install-Dependencies($Dir) {
    Push-Location $Dir
    try {
        Write-Section "Installing dependencies in $Dir"
        $hasLock = Test-Path package-lock.json
        if ($Clean) {
            if (Test-Path node_modules) { Write-Warn "Removing node_modules"; Remove-Item -Recurse -Force node_modules }
            if ($hasLock) { Write-Warn "Removing package-lock.json"; Remove-Item -Force package-lock.json }
        }

        if ($Reinstall -and (Test-Path node_modules)) { Write-Warn "Reinstall requested - removing node_modules"; Remove-Item -Recurse -Force node_modules }

        # Run install with robust error handling; external commands don't throw, so check $LASTEXITCODE
        if ($hasLock) {
            & npm ci --no-audit --fund false
            if ($LASTEXITCODE -ne 0) {
                Write-Warn "npm ci failed (exit $LASTEXITCODE). Retrying with cleanup and --legacy-peer-deps"
                if (Test-Path node_modules) { try { Remove-Item -Recurse -Force node_modules } catch { Write-Warn "Failed to remove node_modules: $($_.Exception.Message)" } }
                try { & npm cache clean --force | Out-Null } catch {}
                & npm ci --no-audit --fund false --legacy-peer-deps
                if ($LASTEXITCODE -ne 0) {
                    Write-Warn "npm ci with legacy peer deps failed. Final attempt with npm install --legacy-peer-deps"
                    & npm install --no-audit --fund false --legacy-peer-deps
                    if ($LASTEXITCODE -ne 0) { throw "npm dependency installation failed (exit $LASTEXITCODE)" }
                }
            }
        } else {
            & npm install --no-audit --fund false
            if ($LASTEXITCODE -ne 0) {
                Write-Warn "npm install failed (exit $LASTEXITCODE). Retrying with cleanup and --legacy-peer-deps"
                if (Test-Path node_modules) { try { Remove-Item -Recurse -Force node_modules } catch { Write-Warn "Failed to remove node_modules: $($_.Exception.Message)" } }
                try { & npm cache clean --force | Out-Null } catch {}
                & npm install --no-audit --fund false --legacy-peer-deps
                if ($LASTEXITCODE -ne 0) { throw "npm dependency installation failed (exit $LASTEXITCODE)" }
            }
        }
        Write-Step "Dependencies installed in $Dir"
    } finally { Pop-Location }
}

function Build-Dashboard() {
    if ($SkipDashboardBuild) { Write-Warn "Skipping dashboard build per flag"; return }
    # Join-Path supports only two positional parameters; nest to build multi-segment path
    $dash = Join-Path (Join-Path $PSScriptRoot '..') 'dashboard'
    if (-not (Test-Path (Join-Path $dash 'package.json'))) {
        Write-Warn "Dashboard not found at $dash. Skipping build."
        return
    }

    Push-Location $dash
    try {
        Write-Section "Installing dashboard deps"
        Install-Dependencies $dash
        Write-Section "Building dashboard"
        & npm run build
        Write-Step "Dashboard built successfully"
    } finally { Pop-Location }
}

function Get-Config() {
    $cfgPath = Join-Path (Get-Location) $ConfigPath
    if (-not (Test-Path $cfgPath)) { throw "Config file not found: $cfgPath" }
    $json = Get-Content $cfgPath -Raw | ConvertFrom-Json
    return @{ path = $cfgPath; data = $json }
}

function Save-Config($cfg) {
    $cfg.data | ConvertTo-Json -Depth 20 | Out-File -FilePath $cfg.path -Encoding UTF8
    Write-Step "Config saved: $($cfg.path)"
}

function Test-PortInUse($port) {
    try {
        $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        return $null -ne $conn
    } catch {
        # Fallback: Test-NetConnection
        $tnc = Test-NetConnection -ComputerName 'localhost' -Port $port -WarningAction SilentlyContinue
        return ($tnc.TcpTestSucceeded -and -not $tnc.PingSucceeded)
    }
}

function Find-FreePort([int]$startPort) {
    for ($p = $startPort; $p -lt 65535; $p++) {
        if (-not (Test-PortInUse $p)) { return $p }
    }
    return $null
}

function Ensure-ApiPortAvailable() {
    Write-Section "Checking API port availability"
    $cfg = Get-Config
    $port = $null
    if ($PortOverride) { $port = $PortOverride } else {
        $port = $cfg.data.network.api.port
        if (-not $port) { $port = $cfg.data.api.port }
        if (-not $port) { $port = 8001 }
    }

    if (Test-PortInUse $port) {
        Write-Warn "Port $port is in use. Searching for a free port..."
        $free = Find-FreePort ($port + 1)
        if (-not $free) { throw "No free port found above $port" }
        Write-Warn "Using free port $free and updating config"
        if (-not $cfg.data.network) { $cfg.data | Add-Member -NotePropertyName network -NotePropertyValue (@{}) }
        if (-not $cfg.data.network.api) { $cfg.data.network | Add-Member -NotePropertyName api -NotePropertyValue (@{}) }
        $cfg.data.network.api.port = $free
        # Keep legacy field in sync if exists
        if ($cfg.data.api) { $cfg.data.api.port = $free }
        Save-Config $cfg
        return $free
    }
    else {
        Write-Step "Port $port is available"
        return $port
    }
}

function Validate-Config() {
    Write-Section "Validating configuration via ConfigManager"
    $nodeScript = Join-Path $PSScriptRoot 'validate-config.js'
    if (-not (Test-Path $nodeScript)) {
        # Create at runtime if missing
        $content = @'
const ConfigManager = require("../src/core/ConfigManager");
(async () => {
  try {
    const cfg = new ConfigManager();
    await cfg.load();
    console.log("OK");
    process.exit(0);
  } catch (e) {
    console.error("CONFIG_ERROR:", e && e.message ? e.message : e);
    process.exit(2);
  }
})();
'@
        New-Item -ItemType Directory -Force -Path (Split-Path $nodeScript) | Out-Null
        Set-Content -Path $nodeScript -Value $content -Encoding UTF8
    }
    $env:CONFIG_PATH = $ConfigPath
    $p = Start-Process node -ArgumentList @("`"$nodeScript`"") -NoNewWindow -PassThru -Wait
    if ($p.ExitCode -ne 0) { throw "Configuration validation failed. Check $ConfigPath" }
    Write-Step "Configuration is valid"
}

function Start-Miner() {
    Write-Section "Starting KBUC Miner"
    $env:CONFIG_PATH = $ConfigPath
    if ($StartDashboardDev) {
        Write-Warn "Starting Vite dev server for dashboard (port 5173) in background"
        $dash = Join-Path (Join-Path $PSScriptRoot '..') 'dashboard'
        if (Test-Path (Join-Path $dash 'package.json')) {
            Start-Process npm -WorkingDirectory $dash -ArgumentList @('run','dev','--','--host') -WindowStyle Minimized
        } else { Write-Warn "Dashboard folder not found, skipping dev server" }
    }
    # Run the miner and attach output
    & node "src/main.js" start
}

try {
    Write-Section "KBUC Mining System Installer & Runner"
    Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path) | Out-Null
    Set-Location (Join-Path (Get-Location) '..') | Out-Null

    Ensure-NodeNpm

    Install-Dependencies (Get-Location)
    Build-Dashboard

    $apiPort = Ensure-ApiPortAvailable
    Validate-Config

    Write-Step "API will listen on port $apiPort"
    Start-Miner

} catch {
    Write-Err $_.Exception.Message
    Write-Err "Setup failed. See messages above."
    exit 1
}
