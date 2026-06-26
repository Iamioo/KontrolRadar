@echo off
setlocal
title KontrolRadar PC Prototyp
cd /d "%~dp0"

echo.
echo ================================
echo   KontrolRadar PC Prototyp
echo ================================
echo.

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo Node.js / npm wurde nicht gefunden.
  echo Bitte installiere Node.js und starte die Datei erneut.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Abhaengigkeiten fehlen. Installation wird gestartet...
  call npm.cmd install
  if errorlevel 1 (
    echo.
    echo Installation fehlgeschlagen.
    echo.
    pause
    exit /b 1
  )
)

echo Der Web-Prototyp wird gestartet.
echo Ein Browserfenster sollte sich automatisch oeffnen.
echo Zum Beenden einfach dieses Fenster schliessen oder Strg+C druecken.
echo.

call npm.cmd run web
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" (
  echo Der Prototyp wurde mit Fehlercode %EXIT_CODE% beendet.
) else (
  echo Der Prototyp wurde beendet.
)
echo.
pause
exit /b %EXIT_CODE%
