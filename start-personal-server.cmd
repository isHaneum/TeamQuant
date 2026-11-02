@echo off
cd /d "%~dp0"
node launch-personal-server.mjs
if errorlevel 1 pause
