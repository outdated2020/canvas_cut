param(
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $SkipBuild) {
    Write-Host "Building all workspaces..."
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Build failed with exit code $LASTEXITCODE"
        exit $LASTEXITCODE
    }
}

$desktopDir = Join-Path $root "apps\desktop"
$electronExe = Join-Path $desktopDir "node_modules\electron\dist\electron.exe"
$electronCmd = Join-Path $desktopDir "node_modules\.bin\electron.cmd"

Set-Location $desktopDir

if (Test-Path -LiteralPath $electronExe) {
    Write-Host "Starting Canvas Cut desktop..."
    $proc = Start-Process -FilePath $electronExe -ArgumentList "." -WorkingDirectory $desktopDir -PassThru -Wait
    $LASTEXITCODE = $proc.ExitCode
}
elseif (Test-Path -LiteralPath $electronCmd) {
    Write-Host "Starting Canvas Cut desktop via npm bin..."
    $proc = Start-Process -FilePath $electronCmd -ArgumentList "." -WorkingDirectory $desktopDir -PassThru -Wait
    $LASTEXITCODE = $proc.ExitCode
}
else {
    Write-Error "Electron is not installed. Run 'npm install' first."
    exit 1
}
