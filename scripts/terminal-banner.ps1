# 「蔵書ターミナル」ショートカットから開いたPowerShellの起動時に表示するバナー。
# よく使う手動コマンドの一覧を示すだけで、何も実行はしない
# （notebooklm login はブラウザでの対話的ログインが必要なため、AIには代行させず
#  ユーザー自身がここから実行する。doc/07_user_manual.md参照）。

Write-Host ""
Write-Host "=== 蔵書ライブラリアン: よく使うコマンド ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "  node src/build/build.js        " -NoNewline -ForegroundColor Yellow
Write-Host "蔵書データベースを更新（新しい本の反映）"
Write-Host "  npm run viewer                 " -NoNewline -ForegroundColor Yellow
Write-Host "ブラウザ版ビューア/エディタを起動"
Write-Host "  notebooklm login               " -NoNewline -ForegroundColor Yellow
Write-Host "NotebookLM連携のログイン（初回・再認証時）"
Write-Host "  node src/cli/enrich.js review  " -NoNewline -ForegroundColor Yellow
Write-Host "ISBN・NDCのレビュー待ちを確認"
Write-Host "  npm run test:all               " -NoNewline -ForegroundColor Yellow
Write-Host "回帰試験を実行"
Write-Host ""
