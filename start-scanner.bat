@echo off
title Wi-Fi Scanner Pro - Local Agent
echo ===================================================
echo  Starting Wi-Fi Scanner Pro Local Agent...
echo ===================================================
echo.

cd /d "%~dp0"

if not exist node_modules (
    echo Installing dependencies...
    npm install
)

echo Starting scanner agent on http://localhost:7778 ...
node local-scanner.js
pause
