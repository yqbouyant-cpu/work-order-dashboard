@echo off
cd /d "%~dp0"

set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

echo.
echo 正在启动工单五模块管理看板...
echo 启动后请不要关闭这个黑色窗口。
echo 浏览器将自动打开：http://localhost:3000
echo.

if exist "%NODE_EXE%" (
  start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3000"
  "%NODE_EXE%" server.js
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo 没有检测到 Node.js，暂时无法启动本地看板。
    echo 请先安装 Node.js LTS 版本，然后重新双击这个文件。
    echo 下载地址：https://nodejs.org/
    echo.
    pause
    exit /b 1
  )
  start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3000"
  node server.js
)

pause
