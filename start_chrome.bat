@echo off
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --remote-debugging-port=9222 --no-sandbox --disable-gpu --disable-software-rasterizer --no-first-run --disable-extensions --disable-popup-blocking --disable-default-apps http://localhost:8080
