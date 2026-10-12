@echo off
rem Privat lokal visning av Karsan tracker med S&P 500, OAS, MOVE og gull.
rem Lisensbegrensede data lagres bare i private\ og committes aldri.
cd /d "%~dp0"
set "PY=python"
if exist "%LOCALAPPDATA%\Python\bin\python.exe" set "PY=%LOCALAPPDATA%\Python\bin\python.exe"
"%PY%" scripts\lokal_visning.py
pause
