@echo off
chcp 65001 >nul
title 同步到发布目录
set SRC=%~dp0
set DST=D:\tc-deploy

echo ==========================================
echo   同步到发布目录
echo   源  : %SRC%
echo   目标: %DST%
echo ==========================================
echo.

if not exist "%DST%" mkdir "%DST%"

echo [1/3] 复制 index.html / today.html / style.css ...
copy /Y "%SRC%index.html"  "%DST%\" >nul
copy /Y "%SRC%today.html"  "%DST%\" >nul
copy /Y "%SRC%style.css"   "%DST%\" >nul

echo [2/3] 同步 js 目录（含 vendor 里的 SDK）...
if exist "%DST%\js" rmdir /S /Q "%DST%\js"
xcopy /E /I /Q "%SRC%js" "%DST%\js" >nul

echo [3/3] 检查是否混入私人数据...
dir /B "%DST%\dispatch-data" >nul 2>&1
if %errorlevel%==0 (
    echo    [!] 发现 dispatch-data，已删除，避免私人数据被上传
    rmdir /S /Q "%DST%\dispatch-data"
)

echo.
echo ==========================================
echo   完成
echo   现在回到对话里说「发布」，由 WorkBuddy 推上去
echo ==========================================
echo.
echo 不上传的东西（发布目录永远不含）：
echo   dispatch-data / backup / history / *.md 文档 / server / .git
echo.
pause
