@echo off
setlocal

set "CF_PATH=C:\Program Files (x86)\cloudflared\cloudflared.exe"

if not exist "%CF_PATH%" (
  echo cloudflared was not found at:
  echo %CF_PATH%
  echo.
  echo Install it first, then run this command again.
  exit /b 1
)

"%CF_PATH%" tunnel --url http://localhost:3000 --no-autoupdate --protocol http2
