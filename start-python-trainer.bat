@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if errorlevel 1 (
  echo Python launcher ^(py.exe^) was not found in PATH.
  pause
  exit /b 1
)

if not exist "trainer\.venv\Scripts\python.exe" (
  echo Creating Python virtual environment...
  py -3 -m venv "trainer\.venv"
  if errorlevel 1 goto :failed
)

echo Installing or updating the Python game and lab...
"trainer\.venv\Scripts\python.exe" -m pip install -e "trainer[ui]"
if errorlevel 1 goto :failed

echo Starting TetraFlux Python Lab...
"trainer\.venv\Scripts\python.exe" -m tetraflux_trainer.app
if errorlevel 1 goto :failed
exit /b 0

:failed
echo.
echo Python lab startup failed.
pause
exit /b 1
