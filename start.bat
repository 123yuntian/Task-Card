@echo off
chcp 65001 >nul
cd /d "%~dp0"

set PORT=8317
set NODE_EXE="C:\Program Files\nodejs\node.exe"
set URL=http://127.0.0.1:%PORT%/index.html

rem --- is the port already taken? ---
netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul
if not %errorlevel%==0 goto :start_server

rem --- taken: is it our own server? ask it who it is ---
curl -s --max-time 2 http://127.0.0.1:%PORT%/api/health | findstr /C:"task-card-dispatch" >nul
if %errorlevel%==0 goto :already_running

echo.
echo [start.bat] Port %PORT% is in use by something else.
echo It did not answer as Task Card. Close that program, then run this again.
echo.
pause
exit /b 1

:already_running
echo.
echo [start.bat] Task Card server is ALREADY running on port %PORT%.
echo Opening the browser now. Do NOT kill node.exe.
echo Tip: press Ctrl+F5 in the browser if the page looks old.
echo.
start "" "%URL%"
timeout /t 3 >nul
exit /b 0

:start_server
rem --- launch the server in its own window so this script can continue ---
start "TaskCard server on %PORT%" %NODE_EXE% server\main.mjs

rem --- give the server a moment to boot, then open the browser ---
timeout /t 2 /nobreak >nul
start "" "%URL%"

echo.
echo [start.bat] Server started on http://127.0.0.1:%PORT%
echo [start.bat] Close the "TaskCard server on %PORT%" window to stop it.
echo.
timeout /t 3 >nul
