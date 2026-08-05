@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Windup Local Development

set "WINDUP_ROOT=%~dp0"
set "BACKEND_DIR=%WINDUP_ROOT%backend"
set "FRONTEND_DIR=%WINDUP_ROOT%frontend"
set "BACKEND_URL=http://127.0.0.1:8000"
set "FRONTEND_URL=http://127.0.0.1:5173"
set "REDIS_ENABLED=false"
set "REDIS_URL=redis://127.0.0.1:6379/0"

echo ============================================
echo   Windup local development launcher
echo ============================================
echo.

if not exist "%BACKEND_DIR%\pyproject.toml" (
  echo [ERROR] Backend directory not found: %BACKEND_DIR%
  goto :failed
)

if not exist "%FRONTEND_DIR%\package.json" (
  echo [ERROR] Frontend directory not found: %FRONTEND_DIR%
  goto :failed
)

where uv >nul 2>&1
if errorlevel 1 (
  echo [ERROR] uv was not found in PATH.
  echo         Install it from https://docs.astral.sh/uv/getting-started/installation/
  goto :failed
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm was not found in PATH. Install Node.js first.
  goto :failed
)

echo [Backend] Preparing dependencies...
pushd "%BACKEND_DIR%"
uv sync --all-packages
if errorlevel 1 (
  popd
  echo [ERROR] Backend dependency setup failed.
  goto :failed
)
popd

echo [Frontend] Preparing dependencies...
pushd "%FRONTEND_DIR%"
call npm install --no-audit --no-fund
if errorlevel 1 (
  popd
  echo [ERROR] Frontend dependency setup failed.
  goto :failed
)
popd

if /i "%~1"=="--check" goto :check_only

echo [Redis] Configured but disabled. The local login does not require Redis.

echo [Backend] Initializing SQLite and starting the API...
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  start "Windup Backend" cmd /k "cd /d ""%BACKEND_DIR%"" && set ""SQLITE_PATH=./windup.db"" && set ""REDIS_ENABLED=%REDIS_ENABLED%"" && set ""REDIS_URL=%REDIS_URL%"" && set ""WINDUP_HOST=127.0.0.1"" && set ""WINDUP_PORT=8000"" && uv run python init_db.py"
) else (
  echo       Port 8000 is already in use. Reusing the running service.
)

echo [Backend] Waiting for the API...
powershell -NoProfile -Command "$deadline=(Get-Date).AddSeconds(45); do { try { $response=Invoke-WebRequest -UseBasicParsing -Uri '%BACKEND_URL%/docs' -TimeoutSec 2; if ($response.StatusCode -eq 200) { exit 0 } } catch {}; Start-Sleep -Milliseconds 500 } while ((Get-Date) -lt $deadline); exit 1"
if errorlevel 1 (
  echo [ERROR] Backend was not ready after 45 seconds.
  echo         Check the Windup Backend window for details.
  goto :failed
)

echo [Frontend] Starting the development server...
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  start "Windup Frontend" cmd /k "cd /d ""%FRONTEND_DIR%"" && npm run dev -- --host 127.0.0.1 --port 5173 --strictPort"
) else (
  echo       Port 5173 is already in use. Reusing the running service.
)

powershell -NoProfile -Command "$deadline=(Get-Date).AddSeconds(45); do { try { $response=Invoke-WebRequest -UseBasicParsing -Uri '%FRONTEND_URL%' -TimeoutSec 2; if ($response.StatusCode -eq 200) { exit 0 } } catch {}; Start-Sleep -Milliseconds 500 } while ((Get-Date) -lt $deadline); exit 1"
if errorlevel 1 (
  echo [ERROR] Frontend was not ready after 45 seconds.
  echo         Check the Windup Frontend window for details.
  goto :failed
)

echo.
echo ============================================
echo   Windup is ready
echo   Frontend : %FRONTEND_URL%
echo   Backend  : %BACKEND_URL%
echo   API docs : %BACKEND_URL%/docs
echo   Database : %BACKEND_DIR%\windup.db
echo   Redis    : disabled ^(%REDIS_URL% reserved^)
echo ============================================
echo.
start "" "%FRONTEND_URL%"
echo You may close this launcher window. Both services will keep running.
pause >nul
exit /b 0

:check_only
echo.
echo [OK] Paths, tools, and dependencies are ready.
echo      Redis is configured but disabled by default:
echo      REDIS_ENABLED=%REDIS_ENABLED%
echo      REDIS_URL=%REDIS_URL%
echo      SQLite will be created or reused at:
echo      %BACKEND_DIR%\windup.db
exit /b 0

:failed
echo.
echo Startup did not complete. Fix the error above and run start.bat again.
pause
exit /b 1
