@echo off
title Farm Game
echo [SYSTEM] Starting Farm Game server + client...
start "Farm Game Server" cmd /k "cd /d %~dp0server && npm run dev"
start "Farm Game Client" cmd /k "cd /d %~dp0client && npm run dev"
echo - Farm Game Client: http://localhost:5173
echo - Farm Game Server: http://localhost:5454
echo (chat bridge needs the YelloTalk bot backend on :5353)
