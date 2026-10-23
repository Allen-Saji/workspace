@echo off
setlocal
cd /d "%~dp0"
set "PATH=%LOCALAPPDATA%\Programs\NodeLTS\node-v24.22.1-win-x64;%PATH%"
set "NEXT_TELEMETRY_DISABLED=1"
call npm.cmd run start
