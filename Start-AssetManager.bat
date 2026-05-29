@echo off
title IT Asset Manager
cd /d "%~dp0"

echo ============================================
echo    IT Asset Manager - HV Hygiene Vietnam
echo ============================================
echo.

REM --- Make sure Node.js is available ---
where node >nul 2>nul
if errorlevel 1 (
  if exist "C:\Program Files\nodejs\node.exe" (
    set "PATH=C:\Program Files\nodejs;%PATH%"
  ) else (
    echo  [!] Node.js is not installed on this computer.
    echo.
    echo      Please install Node.js LTS from:  https://nodejs.org
    echo      Then double-click this file again.
    echo.
    pause
    exit /b 1
  )
)

REM --- Install dependencies on first run ---
if not exist "node_modules" (
  echo  Installing required components - this happens only once...
  echo.
  call npm install
  echo.
)

echo  Starting the server...
echo  When it says "running", open your browser to:  http://localhost:3000
echo.
echo  (Leave this window open while using the app. Close it to stop.)
echo.

REM --- Open the browser and start the server ---
start "" http://localhost:3000
node server.js

pause
