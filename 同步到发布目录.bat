@echo off
setlocal
title Sync Task Card to deploy dir
set SRC=%~dp0
set DST=D://tc-deploy

echo ==========================================
echo   Sync Task Card to deploy directory
echo   Source : %SRC%
echo   Target : %DST%
echo ==========================================
echo.

if not exist "%DST%" mkdir "%DST%"

echo [1/4] index.html / today.html / style.css
copy /Y "%SRC%index.html" "%DST%\" >nul
copy /Y "%SRC%today.html" "%DST%\" >nul
copy /Y "%SRC%style.css"  "%DST%\" >nul

echo [2/4] js folder (including vendor SDK)
if exist "%DST%\js" rmdir /S /Q "%DST%\js"
xcopy /E /I /Q "%SRC%js" "%DST%\js" >nul

echo [3/4] manifest.webmanifest + assets\icons
copy /Y "%SRC%manifest.webmanifest" "%DST%\" >nul
if exist "%DST%\assets" rmdir /S /Q "%DST%\assets"
xcopy /E /I /Q "%SRC%assets" "%DST%\assets" >nul

echo [4/4] strip private data
if exist "%DST%\dispatch-data" rmdir /S /Q "%DST%\dispatch-data"
if exist "%DST%\backup" rmdir /S /Q "%DST%\backup"

echo.
echo ==========================================
echo   DONE. Go back to the chat and type: publish
echo ==========================================
echo.
echo Not uploaded: dispatch-data / backup / history / *.md / server / .git
echo.
pause
