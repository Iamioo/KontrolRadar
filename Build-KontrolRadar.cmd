@echo off
setlocal
title KontrolRadar Build Assistent
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js wurde nicht gefunden.
  echo Bitte installiere Node.js und starte die Datei erneut.
  echo.
  pause
  exit /b 1
)

node "%~dp0tools\build-release.mjs"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" (
  echo Build-Assistent mit Fehlercode %EXIT_CODE% beendet.
) else (
  echo Build-Assistent erfolgreich beendet.
)
echo.
pause
exit /b %EXIT_CODE%
