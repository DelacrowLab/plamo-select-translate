# 配布用の zip を 3 種類作り、dist/ に置く。個人配布用は Downloads フォルダ(このフォルダの 1 つ上)にもコピーする。
#   plamo-translate-ext-<版>.zip         個人配布用(拡張機能+翻訳サーバーのセット+説明書)
#   plamo-translate-ext-<版>-store.zip   Chrome ウェブストア提出用(拡張機能の動作に必要なファイルだけ)
#   plamo-translate-server-<版>.zip      翻訳サーバーのセット(ストアから入れた人向け。GitHub Releases に置く)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$version = (Get-Content (Join-Path $root "manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json).version

$extFiles = @(
  "manifest.json", "background.js", "content.js", "shared.js", "options.html", "options.js", "result.html", "result.js",
  "icons\icon16.png", "icons\icon32.png", "icons\icon48.png", "icons\icon128.png", "LICENSE"
)
$serverFiles = @(
  "start-server.bat", "start-server.ps1", "自動起動を設定する.bat", "自動起動を解除する.bat",
  "はじめにお読みください(Windows).txt", "LICENSE",
  "start-server.sh", "翻訳サーバーを起動する.command", "自動起動を設定する.command", "自動起動を解除する.command",
  "はじめにお読みください(Mac).txt",
  "third_party\PLaMo-Community-License-ja.txt", "third_party\PLaMo-Community-License-en.txt"
)

# zip は git archive で、コミット済みの内容から作る。
#   - Mac 用の .command / .sh の実行権限(git に記録した 755)が zip に残る
#     (Windows の .NET や Compress-Archive で作ると実行権限が失われ、Mac でダブルクリックしても動かない)
#   - パス区切りは「/」、日本語のファイル名は UTF-8 で記録される
#   - 改行コードは .gitattributes に従う(.bat / .ps1 は CRLF、それ以外は LF)
# そのため、配布物に入るファイルに未コミットの変更があると止める。
$git = (Get-Command git -ErrorAction Stop).Source

function Build([string[]]$files, [string]$zipName, [string]$prefix) {
  $paths = $files | Select-Object -Unique | ForEach-Object { $_.Replace('\', '/') }
  $zip = Join-Path $dist $zipName
  $gargs = @("-C", $root, "-c", "core.quotepath=false", "archive", "--format=zip", "-o", $zip)
  if ($prefix) { $gargs += "--prefix=$prefix" }
  $gargs += @("HEAD", "--") + $paths
  & $git @gargs
  if ($LASTEXITCODE -ne 0) { throw "git archive に失敗しました: $zipName" }
  return $zip
}

$allFiles = ($extFiles + $serverFiles) | Select-Object -Unique | ForEach-Object { $_.Replace('\', '/') }
$dirty = & $git -C $root -c core.quotepath=false status --porcelain -- @allFiles
if ($dirty) {
  Write-Host "配布物に入るファイルに、コミットしていない変更があります。先にコミットしてください:" -ForegroundColor Red
  $dirty | ForEach-Object { Write-Host "  $_" }
  exit 1
}

$dist = Join-Path $root "dist"
New-Item -ItemType Directory -Force $dist | Out-Null
Get-ChildItem $dist -Filter *.zip -ErrorAction SilentlyContinue | Remove-Item -Force

$personal = Build ($extFiles + $serverFiles) "plamo-translate-ext-$version.zip" "plamo-translate-ext/"
$store    = Build $extFiles "plamo-translate-ext-$version-store.zip" ""
$server   = Build $serverFiles "plamo-translate-server-$version.zip" "plamo-translate-server/"

$downloads = Split-Path $root -Parent
Copy-Item $personal (Join-Path $downloads (Split-Path $personal -Leaf)) -Force

Get-ChildItem $dist -Filter *.zip | Select-Object Name, Length
"個人配布用のコピー: " + (Join-Path $downloads (Split-Path $personal -Leaf))
