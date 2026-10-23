@echo off
title Product Management System
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download it from https://nodejs.org and run this file again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies - this takes a minute the first time...
  call npm install || goto :error
)

if not exist client\dist\index.html (
  echo Building the web app...
  call npm run build || goto :error
)

echo.
echo Starting... open http://localhost:5050 in your browser.
echo Keep this window open while you use the app. Press Ctrl+C to stop.
echo.
node server\index.js
pause
exit /b 0

:error
echo.
echo Something went wrong. See the messages above.
pause
exit /b 1
