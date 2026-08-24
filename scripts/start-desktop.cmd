@echo off
setlocal
cd /d "%~dp0\.."

echo Building all workspaces...
call npm run build
if errorlevel 1 (
  echo Build failed with exit code %errorlevel%
  exit /b %errorlevel%
)

cd /d "%~dp0\..\apps\desktop"

if exist "node_modules\electron\dist\electron.exe" (
  echo Starting Canvas Cut desktop...
  "node_modules\electron\dist\electron.exe" .
  exit /b %errorlevel%
)

if exist "node_modules\.bin\electron.cmd" (
  echo Starting Canvas Cut desktop via npm bin...
  call "node_modules\.bin\electron.cmd" .
  exit /b %errorlevel%
)

echo Electron is not installed. Run "npm install" first.
exit /b 1
