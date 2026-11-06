@echo off
rem Remove the auto-start registration and stop the translation server.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-server.ps1" -Uninstall
