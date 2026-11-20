@echo off
chcp 65001 >nul
title Архив сайта АТС — локальный просмотр
cd /d "%~dp0"

rem Открывает архив сайта в браузере. Нужен установленный Node.js (node --version).
rem Если Node нет — откроется этот файл в блокноте с объяснением, что делать.

where node >nul 2>nul
if errorlevel 1 goto nonode

start "" cmd /c "timeout /t 2 >nul & start "" http://localhost:8080"
node serve.mjs
goto end

:nonode
echo.
echo   Не найден Node.js — без него локальный просмотр не запустится.
echo.
echo   Что делать:
echo     1. Поставьте Node.js LTS с https://nodejs.org (кнопка "LTS", установка "далее-далее").
echo     2. Закройте это окно и снова запустите start.cmd.
echo.
echo   Либо просто откройте живой сайт: https://ats-rostov.ru
echo.
pause

:end
