@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo ========================================
echo TetraFlux Web Policy Training Pipeline
echo ========================================

REM ===== settings =====
set LOG_DIR=collected_logs
set DATA_DIR=data
set MODEL_DIR=models\web_human_policy_clean
set PUBLIC_MODEL_DIR=public\models

set MERGED_LOGS=%DATA_DIR%\merged_web_logs.jsonl
set AUDIT_JSON=%DATA_DIR%\audit_web_logs.json
set CLEAN_LOGS=%DATA_DIR%\merged_web_logs_clean.jsonl
set DATASET=%DATA_DIR%\web_human_dataset_clean.jsonl
set CHECKPOINT=%MODEL_DIR%\best_policy.pt
set WEB_POLICY_JSON=%PUBLIC_MODEL_DIR%\web_policy.json

set TRAINER_VERSION=web-ft5-0.2.0

set MAX_HOLES=20
set MAX_HEIGHT=18
set MAX_PENDING_GARBAGE=8
set MIN_ROUND_LENGTH=8

set EPOCHS=50
set BATCH_SIZE=256
set DEVICE=auto

REM ===== folders =====
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"
if not exist "%MODEL_DIR%" mkdir "%MODEL_DIR%"
if not exist "%PUBLIC_MODEL_DIR%" mkdir "%PUBLIC_MODEL_DIR%"

echo.
echo [0/6] Checking logs...
dir /b "%LOG_DIR%\*.jsonl" >nul 2>nul
if errorlevel 1 (
    echo No .jsonl files found in "%LOG_DIR%".
    echo Put downloaded trainer logs into "%LOG_DIR%" first.
    pause
    exit /b 1
)

echo.
echo [1/6] Merge JSONL logs...
python tools\merge_jsonl.py --input "%LOG_DIR%" --out "%MERGED_LOGS%"
if errorlevel 1 goto :error

echo.
echo [2/6] Audit merged logs...
python tools\audit_web_logs.py --input "%MERGED_LOGS%" --out "%AUDIT_JSON%"
if errorlevel 1 goto :error

echo.
echo [3/6] Filter dirty / old / losing logs...
python tools\filter_web_logs.py ^
  --input "%MERGED_LOGS%" ^
  --out "%CLEAN_LOGS%" ^
  --trainer-version "%TRAINER_VERSION%" ^
  --winner human ^
  --max-holes %MAX_HOLES% ^
  --max-height %MAX_HEIGHT% ^
  --max-pending-garbage %MAX_PENDING_GARBAGE% ^
  --min-round-length %MIN_ROUND_LENGTH%

if errorlevel 1 goto :error

echo.
echo [4/6] Build clean dataset...
python tools\build_web_dataset.py --input "%CLEAN_LOGS%" --out "%DATASET%"
if errorlevel 1 goto :error

echo.
echo [5/6] Train policy...
python tools\train_web_policy.py ^
  --data "%DATASET%" ^
  --out-dir "%MODEL_DIR%" ^
  --epochs %EPOCHS% ^
  --batch-size %BATCH_SIZE% ^
  --device %DEVICE%

if errorlevel 1 goto :error

echo.
echo [6/6] Export PyTorch checkpoint to browser JSON...
python tools\export_web_policy_json.py ^
  --checkpoint "%CHECKPOINT%" ^
  --out "%WEB_POLICY_JSON%"

if errorlevel 1 goto :error

echo.
echo ========================================
echo Done.
echo ========================================
echo Checkpoint:
echo   %CHECKPOINT%
echo Web model:
echo   %WEB_POLICY_JSON%
echo.
echo Now run:
echo   npm run dev
echo.
pause
exit /b 0

:error
echo.
echo ========================================
echo ERROR: Training pipeline failed.
echo ========================================
echo Check the message above.
pause
exit /b 1