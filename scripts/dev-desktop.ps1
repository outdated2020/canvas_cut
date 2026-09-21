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

# 启动 vite dev server（隐藏窗口，输出重定向到日志文件）
$viteProcess = Start-Process `
    -FilePath $nodeExe `
    -ArgumentList "`"$viteJs`"", "--host", "127.0.0.1", "--port", "5173", "--strictPort" `
    -WorkingDirectory $desktopDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $viteOutLog `
    -RedirectStandardError $viteErrLog `
    -PassThru

try {
    # 等待 vite 启动
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        $viteProcess.Refresh()
        if ($viteProcess.HasExited) {
            Get-Content -LiteralPath $viteErrLog -ErrorAction SilentlyContinue | Write-Host
            throw "Vite failed to start. Port 5173 may already be in use; close the existing dev server and retry."
        }
        try {
            $response = Invoke-WebRequest -Uri "http://127.0.0.1:5173/@vite/client" -UseBasicParsing -TimeoutSec 1
            if ($response.StatusCode -eq 200) { $ready = $true; break }
        } catch { }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) { throw "Vite did not become ready. See $viteErrLog" }
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

    $env:VITE_DEV_SERVER_URL = "http://127.0.0.1:5173"
    Write-Host "Starting Canvas Cut desktop in development mode..."
    Write-Host "Vite logs: $viteOutLog"
    Write-Host "(Close the app window to return to the shell)"

    # Electron 用独立窗口启动并等待退出
    if (Test-Path -LiteralPath $electronExe) {
        $electronProc = Start-Process -FilePath $electronExe -ArgumentList "." -WorkingDirectory $desktopDir -PassThru -Wait
        $LASTEXITCODE = $electronProc.ExitCode
        if ($LASTEXITCODE -ne 0) { throw "Electron exited with code $LASTEXITCODE" }
        Write-Host "Canvas Cut exited or handed off to an existing instance. Close the existing app before restarting in development mode."
    }
    elseif (Test-Path -LiteralPath $electronCmd) {
        $electronProc = Start-Process -FilePath $electronCmd -ArgumentList "." -WorkingDirectory $desktopDir -PassThru -Wait
        $LASTEXITCODE = $electronProc.ExitCode
        if ($LASTEXITCODE -ne 0) { throw "Electron exited with code $LASTEXITCODE" }
        Write-Host "Canvas Cut exited or handed off to an existing instance. Close the existing app before restarting in development mode."
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
    Write-Host "Vite dev server stopped."
}
