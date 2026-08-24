param(
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $SkipBuild) {
    Write-Host "Building core and desktop..."
    npm run build:core
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    npm run build:desktop
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$desktopDir = Join-Path $root "apps\desktop"
$rootBin = Join-Path $root "node_modules\.bin"
$desktopBin = Join-Path $desktopDir "node_modules\.bin"
$electronExe = Join-Path $desktopDir "node_modules\electron\dist\electron.exe"
$electronCmd = Join-Path $desktopBin "electron.cmd"
if (-not (Test-Path -LiteralPath $electronCmd)) {
    $electronCmd = Join-Path $rootBin "electron.cmd"
}

# 直接找到 vite 的 js 入口，用 node 启动（避免 cmd 中间层导致子进程残留）
$viteJs = Join-Path $root "node_modules\vite\bin\vite.js"
if (-not (Test-Path -LiteralPath $viteJs)) {
    $viteJs = Join-Path $desktopDir "node_modules\vite\bin\vite.js"
}

if (-not (Test-Path -LiteralPath $viteJs)) {
    Write-Error "Vite is not installed. Run 'npm install' first."
    exit 1
}

$nodeExe = (Get-Command node).Source
$viteOutLog = Join-Path $env:TEMP "canvas-cut-vite-out.log"
$viteErrLog = Join-Path $env:TEMP "canvas-cut-vite-err.log"

Set-Location $desktopDir

# 先清理可能残留的旧 vite 进程（端口 5173 上的）
$orphanVites = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match "vite\.js.*5173" }
foreach ($p in $orphanVites) {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}
if ($orphanVites -and $orphanVites.Count -gt 0) {
    Write-Host "Cleaned up $($orphanVites.Count) leftover vite process(es)"
}

# 启动 vite dev server（隐藏窗口，输出重定向到日志文件）
$viteProcess = Start-Process `
    -FilePath $nodeExe `
    -ArgumentList "`"$viteJs`"", "--host", "127.0.0.1", "--port", "5173" `
    -WorkingDirectory $desktopDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $viteOutLog `
    -RedirectStandardError $viteErrLog `
    -PassThru

try {
    # 等待 vite 启动
    Start-Sleep -Seconds 3

    $env:VITE_DEV_SERVER_URL = "http://127.0.0.1:5173"
    Write-Host "Starting Canvas Cut desktop in development mode..."
    Write-Host "Vite logs: $viteOutLog"
    Write-Host "(Close the app window to return to the shell)"

    # Electron 用独立窗口启动并等待退出
    if (Test-Path -LiteralPath $electronExe) {
        $electronProc = Start-Process -FilePath $electronExe -ArgumentList "." -WorkingDirectory $desktopDir -PassThru -Wait
        $LASTEXITCODE = $electronProc.ExitCode
    }
    elseif (Test-Path -LiteralPath $electronCmd) {
        $electronProc = Start-Process -FilePath $electronCmd -ArgumentList "." -WorkingDirectory $desktopDir -PassThru -Wait
        $LASTEXITCODE = $electronProc.ExitCode
    }
    else {
        Write-Error "Electron is not installed. Run 'npm install' first."
        exit 1
    }
}
finally {
    # 清理 vite 进程
    if ($viteProcess -and -not $viteProcess.HasExited) {
        Stop-Process -Id $viteProcess.Id -Force -ErrorAction SilentlyContinue
    }
    # 保险：再扫一遍所有 5173 端口的 vite 进程
    $remaining = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match "vite\.js.*5173" }
    foreach ($p in $remaining) {
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Write-Host "Vite dev server stopped."
}
