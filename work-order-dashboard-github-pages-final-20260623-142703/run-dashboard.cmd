@echo off
cd /d "%~dp0"

set "BUNDLED_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

echo.
echo Starting work-order dashboard...
echo Keep this window open while using the dashboard.
echo Browser URL: http://localhost:3000
echo.

start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3000"

if exist "%BUNDLED_NODE%" (
  "%BUNDLED_NODE%" server.js
) else (
  node server.js
)

echo.
echo Dashboard stopped. Press any key to close this window.
pause >nul
