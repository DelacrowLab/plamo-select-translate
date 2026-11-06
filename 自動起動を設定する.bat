@echo off
rem Register the translation server to start automatically at sign-in.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-server.ps1" -Install
