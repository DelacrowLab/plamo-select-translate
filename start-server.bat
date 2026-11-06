@echo off
rem Starts the PLaMo 3 Translate server. The model menu (0.8B / 2B) is in start-server.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-server.ps1"
