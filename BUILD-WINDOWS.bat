@echo off
setlocal enabledelayedexpansion
title EGCO Dashboard - Build
cd /d "%~dp0"

echo.
echo ============================================
echo    EGCO Dashboard - Windows Build
echo ============================================
echo.

REM ---------------------------------------------------------------
REM  Node and Python are often installed but missing from PATH.
REM  Relying on `where` alone made the build fail on a machine that
REM  already had both. Search the standard install locations too.
REM ---------------------------------------------------------------

echo [1/5] Looking for Node.js ...
set "NODE_OK="
where node >nul 2>nul && set "NODE_OK=1"

if not defined NODE_OK (
  if exist "%ProgramFiles%\nodejs\node.exe" (
    set "PATH=%ProgramFiles%\nodejs;%PATH%"
    set "NODE_OK=1"
  )
)
if not defined NODE_OK (
  if exist "%ProgramFiles(x86)%\nodejs\node.exe" (
    set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%"
    set "NODE_OK=1"
  )
)
if not defined NODE_OK (
  if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
    set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"
    set "NODE_OK=1"
  )
)

if not defined NODE_OK (
  echo.
  echo   Node.js was not found.
  echo.
  echo   Download it from:  https://nodejs.org
  echo   Choose the big green LTS button, install with all defaults,
  echo   then run this file again.
  echo.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do echo       Node %%v


echo [2/5] Looking for Python ...
set "EGCO_PYTHON="

REM plain `python` on PATH
where python >nul 2>nul && set "EGCO_PYTHON=python"

REM the `py` launcher: installed to C:\Windows by default, so it is
REM present even when "Add Python to PATH" was left unchecked
if not defined EGCO_PYTHON (
  where py >nul 2>nul && set "EGCO_PYTHON=py"
)

REM per-user install location
if not defined EGCO_PYTHON (
  for /d %%d in ("%LOCALAPPDATA%\Programs\Python\Python3*") do (
    if exist "%%d\python.exe" set "EGCO_PYTHON=%%d\python.exe"
  )
)

REM machine-wide install location
if not defined EGCO_PYTHON (
  for /d %%d in ("%ProgramFiles%\Python3*") do (
    if exist "%%d\python.exe" set "EGCO_PYTHON=%%d\python.exe"
  )
)

if not defined EGCO_PYTHON (
  echo.
  echo   Python was not found.
  echo.
  echo   Download it from:  https://python.org/downloads
  echo   On the FIRST installer screen, tick the box at the bottom:
  echo       "Add python.exe to PATH"
  echo   Then install, and run this file again.
  echo.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('"%EGCO_PYTHON%" --version') do echo       %%v
echo       using: %EGCO_PYTHON%


echo.
echo [3/5] Installing dependencies (several minutes) ...
call npm install
if errorlevel 1 goto failed
call npm run setup
if errorlevel 1 goto failed

echo.
echo [4/5] Testing the financial calculations ...
call npm run test:api
if errorlevel 1 (
  echo.
  echo   Tests failed. Do not continue - the problem is usually the
  echo   Python environment. Send me the error text above.
  echo.
  pause
  exit /b 1
)

echo.
echo [5/5] Building the installer (longest step - up to 10 minutes) ...
call npm run package
if errorlevel 1 goto failed

echo.
echo ============================================
echo    BUILD SUCCESSFUL
echo ============================================
echo.
echo   The installer is in the "release" folder.
echo   Run the file ending in  setup.exe
echo.
echo   Note: Windows may warn "Windows protected your PC".
echo   Click  More info  then  Run anyway  (the app is not signed).
echo.
start "" "%~dp0release"
pause
exit /b 0

:failed
echo.
echo   The build failed. Copy the last error message above and send it.
echo.
pause
exit /b 1
