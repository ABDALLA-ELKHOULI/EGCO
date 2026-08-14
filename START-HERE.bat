@echo off
setlocal enabledelayedexpansion
title EGCO Dashboard - Setup and Build
cd /d "%~dp0"

echo.
echo ==================================================
echo    EGCO Dashboard - Automatic Setup and Build
echo ==================================================
echo.

REM ================================================================
REM  A non-English or spaced path breaks python -m venv and later
REM  breaks PyInstaller. Refuse early with a clear instruction
REM  rather than failing three minutes into the build.
REM ================================================================
echo %~dp0 | findstr /r "[^ -~]" >nul
if not errorlevel 1 (
  echo.
  echo   PROBLEM: this folder path contains non-English letters:
  echo.
  echo     %~dp0
  echo.
  echo   Python cannot build inside such a path.
  echo.
  echo   FIX - do this, it takes 30 seconds:
  echo     1. Make a new folder directly on the C: drive
  echo        named exactly:   C:\EGCO
  echo     2. Move ALL the contents of this folder into C:\EGCO
  echo        ^(including the "tools" folder^)
  echo     3. Open C:\EGCO and run START-HERE.bat from there
  echo.
  pause
  exit /b 1
)

echo   Nothing to install by hand. This will:
echo     - use the Node.js bundled in this folder
echo     - install Python automatically if it is missing
echo     - build the Windows installer
echo.
echo   You need an internet connection.
echo   Total time: about 10 to 20 minutes.
echo.
pause


REM ================================================================
REM  Node.js - shipped inside tools\node, no installation needed.
REM ================================================================
echo.
echo [1/5] Node.js ...
if exist "%~dp0tools\node\node.exe" (
  set "PATH=%~dp0tools\node;%PATH%"
  echo       using the bundled copy
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo.
    echo   Node.js is missing and the bundled copy was not found.
    echo   Extract the WHOLE zip including the "tools" folder.
    echo.
    pause
    exit /b 1
  )
  echo       using the copy already on this PC
)
for /f "tokens=*" %%v in ('node -v') do echo       Node %%v


REM ================================================================
REM  Python - every candidate is executed before it is trusted.
REM  Windows ships a fake python.exe stub that only opens the
REM  Microsoft Store; `where python` finds it and it then fails
REM  with exit code 9009. Real installs are checked first.
REM ================================================================
echo.
echo [2/5] Python ...
call :findpython

if not defined EGCO_PYTHON (
  echo       not found - installing it now, please wait ...
  echo       ^(this takes a couple of minutes, do not close anything^)
  "%~dp0tools\python-installer.exe" /quiet InstallAllUsers=0 PrependPath=1 Include_pip=1 Include_test=0
  echo       installer finished, checking ...
  call :findpython
)

if not defined EGCO_PYTHON (
  echo.
  echo   Python could not be installed automatically.
  echo   Open the "tools" folder, run python-installer.exe yourself,
  echo   and on the FIRST screen tick "Add python.exe to PATH".
  echo   Then run this file again.
  echo.
  pause
  exit /b 1
)
echo       using: %EGCO_PYTHON%
for /f "tokens=*" %%v in ('"%EGCO_PYTHON%" --version') do echo       %%v


echo.
echo [3/5] Downloading dependencies (the long part) ...
call npm install
if errorlevel 1 goto failed
call npm run setup
if errorlevel 1 goto failed

echo.
echo [4/5] Checking the financial calculations ...
call npm run test:api
if errorlevel 1 (
  echo.
  echo   The tests failed - stopping here on purpose.
  echo   Copy the error text above and send it.
  echo.
  pause
  exit /b 1
)

echo.
echo [5/6] Building the installer ...
call npm run package
if errorlevel 1 goto failed

REM ================================================================
REM  Company data - a pre-seeded database ships in data\egco-seed.db.
REM  Installed ONLY when the app has no database yet; an existing
REM  database is never overwritten.
REM ================================================================
echo.
echo [6/6] Installing company data ...
if exist "%~dp0data\egco-seed.db" (
  if exist "%APPDATA%\egco-dashboard\egco.db" (
    echo       existing data found - kept as is, nothing overwritten
  ) else (
    mkdir "%APPDATA%\egco-dashboard" 2>nul
    copy /y "%~dp0data\egco-seed.db" "%APPDATA%\egco-dashboard\egco.db" >nul
    echo       company data installed - the app opens ready to use
  )
) else (
  echo       no bundled data - the app starts empty
)

echo.
echo ==================================================
echo    DONE
echo ==================================================
echo.
echo   The "release" folder is opening now.
echo   Run the file whose name ends with  setup.exe
echo.
echo   If Windows says "Windows protected your PC":
echo   click  More info  then  Run anyway.
echo.
start "" "%~dp0release"
pause
exit /b 0


REM ---------------------------------------------------------------
REM  Real installations first, launcher second, PATH last.
:findpython
set "EGCO_PYTHON="
for /d %%d in ("%LOCALAPPDATA%\Programs\Python\Python3*") do call :trypython "%%d\python.exe"
for /d %%d in ("%ProgramFiles%\Python3*") do call :trypython "%%d\python.exe"
for /d %%d in ("%ProgramFiles(x86)%\Python3*") do call :trypython "%%d\python.exe"
where py >nul 2>nul && call :trypython "py"
where python >nul 2>nul && (
  for /f "delims=" %%p in ('where python') do call :trypython "%%p"
)
exit /b 0

REM  %1 is a candidate interpreter. Accept it only if it actually runs.
:trypython
if defined EGCO_PYTHON exit /b 0
echo %~1 | find /i "WindowsApps" >nul && exit /b 0
"%~1" -c "import sys, venv" >nul 2>nul || exit /b 0
set "EGCO_PYTHON=%~1"
exit /b 0


:failed
echo.
echo   Something failed. Copy the last error message above and send it.
echo.
pause
exit /b 1
