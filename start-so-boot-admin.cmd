@echo off
setlocal
if /i "%~1"=="--elevated" goto elevated

rem Reutiliza uma instância existente para não iniciar vários servidores e abas.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ports = 8080..8090; foreach ($port in $ports) { try { $session = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $port + '/api/session') -TimeoutSec 1; if ($session.accountName) { Start-Process ('http://127.0.0.1:' + $port); exit 0 } } catch {} }; $freePort = $ports | Where-Object { -not (Get-NetTCPConnection -LocalPort $_ -State Listen -ErrorAction SilentlyContinue) } | Select-Object -First 1; if ($null -eq $freePort) { Write-Error 'Nenhuma porta livre entre 8080 e 8090.'; exit 1 }; Start-Process -FilePath '%~f0' -ArgumentList @('--elevated', $freePort) -WorkingDirectory '%~dp0' -Verb RunAs"
exit /b

:elevated
set "SO_BOOT_PORT=%~2"
set "PYTHON_EXE="
for /f "delims=" %%P in ('where.exe python.exe 2^>nul') do if not defined PYTHON_EXE set "PYTHON_EXE=%%P"

if not defined PYTHON_EXE (
    echo.
    echo Nao foi possivel localizar o Python no PATH.
    echo Instale o Python 3 e execute este arquivo novamente.
    pause
    exit /b 1
)

start "SO-boot server" /b /d "%~dp0" "%PYTHON_EXE%" -u "%~dp0server.py" > "%~dp0so-boot-server.log" 2>&1

for /l %%I in (1,1,15) do (
    powershell.exe -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:%SO_BOOT_PORT%/' -TimeoutSec 1 ^| Out-Null; exit 0 } catch { exit 1 }"
    if not errorlevel 1 goto open_browser
    timeout /t 1 /nobreak >nul
)

echo.
echo O servidor SO-boot nao iniciou. Veja os detalhes em:
echo %~dp0so-boot-server.log
if exist "%~dp0so-boot-server.log" type "%~dp0so-boot-server.log"
pause
exit /b 1

:open_browser
start "SO-boot" "http://127.0.0.1:%SO_BOOT_PORT%"
exit /b 0
