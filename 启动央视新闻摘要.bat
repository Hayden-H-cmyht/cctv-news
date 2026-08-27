@echo off
rem CCTV News Summary - local server launcher
rem Usage: start local server on port 8801 and open browser.
rem If server already running, just open the page.
rem Close the minimized "cctv-news-server" window to stop.
cd /d "D:\zcode\cctv-news"

rem If port 8801 is already listening -> server is running, open page directly
netstat -ano | findstr ":8801 " | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
  start "" "http://127.0.0.1:8801"
  exit /b
)

rem Start server in a minimized window
start "cctv-news-server" /min python -m http.server 8801 --directory "docs"

rem Wait a moment then open browser
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8801"
exit /b
