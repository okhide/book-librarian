@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 作業フォルダ: %cd%

where claude >nul 2>nul
if %errorlevel%==0 (
    set CLAUDE_CMD=claude
) else if exist "%USERPROFILE%\.local\bin\claude.exe" (
    set CLAUDE_CMD="%USERPROFILE%\.local\bin\claude.exe"
) else (
    echo claudeコマンドが見つかりません。Claude Codeがインストールされているか確認してください。
    pause
    exit /b 1
)

echo 実行するコマンド: %CLAUDE_CMD% "/book-librarian 何ができるか教えてください"
echo.

%CLAUDE_CMD% "/book-librarian 何ができるか教えてください"

echo.
echo ----------------------------------------
echo claudeが終了しました（終了コード: %errorlevel%）。
echo このウィンドウは何かキーを押すまで閉じません。
pause
