@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found in PATH.
  pause
  exit /b 1
)

where py >nul 2>nul
if errorlevel 1 (
  echo Python launcher ^(py.exe^) was not found in PATH.
  pause
  exit /b 1
)

if not exist "node_modules\esbuild" (
  echo Installing Node dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 goto :failed
)

if not exist "trainer\.venv\Scripts\python.exe" (
  echo Creating Python virtual environment...
  py -3 -m venv "trainer\.venv"
  if errorlevel 1 goto :failed
)

echo Installing or updating the Python trainer...
"trainer\.venv\Scripts\python.exe" -m pip install -e "trainer[ui]"
if errorlevel 1 goto :failed

echo Starting TetraFlux Python Trainer...
"trainer\.venv\Scripts\python.exe" -m tetraflux_trainer.app
if errorlevel 1 goto :failed
exit /b 0

:failed
echo.
echo Python trainer startup failed.
pause
exit /b 1
