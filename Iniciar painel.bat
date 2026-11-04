@echo off
chcp 65001 >nul
title Painel DBOW
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js nao encontrado.
  echo  Instale o Node.js 20 ou mais novo ^(versao LTS^) em https://nodejs.org e abra este arquivo de novo.
  echo.
  pause
  exit /b 1
)
node scripts\iniciar-painel.mjs
echo.
pause
