@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Instala Node.js 24 antes de iniciar el portal.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm ci
  if errorlevel 1 exit /b 1
)
echo Portal: http://127.0.0.1:3000
echo Mantén esta ventana abierta para ejecutar la aplicación y el motor.
call npm run local
pause
