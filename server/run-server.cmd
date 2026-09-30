@echo off
rem Keeps the TicketVault server running: restarts it 5 s after any exit.
cd /d "%~dp0"
:loop
"C:\Program Files\nodejs\node.exe" src\index.js >> server.log 2>&1
echo [%date% %time%] server exited with %errorlevel%, restarting >> server.log
timeout /t 5 /nobreak >nul
goto loop
