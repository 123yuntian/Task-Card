@echo off
chcp 65001 >nul
cd /d "%~dp0"

set PORT=8317
set PY="C:\Users\10561\AppData\Local\Programs\Python\Python312\python.exe"
set URL=http://127.0.0.1:%PORT%/index.html

rem --- check if the port is already taken ---
netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul
if %errorlevel%==0 (
    echo.
    echo [start.bat] Port %PORT% is already in use.
    echo Most likely a previous server window is still open.
    echo Close that window, or kill python.exe in Task Manager, then try again.
    echo.
    pause
    exit /b 1
)

rem --- launch the static server in its own window so this script can continue ---
start "TaskCard server on %PORT%" %PY% -m http.server %PORT% --bind 127.0.0.1

rem --- give the server a moment to boot, then open the browser ---
timeout /t 2 /nobreak >nul
start "" "%URL%"

echo.
echo [start.bat] Server started on http://127.0.0.1:%PORT%
echo [start.bat] Close the "TaskCard server on %PORT%" window to stop it.
echo.
timeout /t 3 >nul
