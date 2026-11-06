# 配布用の zip を 3 種類作り、dist/ に置く。個人配布用は Downloads フォルダ(このフォルダの 1 つ上)にもコピーする。
#   plamo-translate-ext-<版>.zip         個人配布用(拡張機能+翻訳サーバーのセット+説明書)
#   plamo-translate-ext-<版>-store.zip   Chrome ウェブストア提出用(拡張機能の動作に必要なファイルだけ)
#   plamo-translate-server-<版>.zip      翻訳サーバーのセット(ストアから入れた人向け。GitHub Releases に置く)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$version = (Get-Content (Join-Path $root "manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json).version

$extFiles = @(
  "manifest.json", "background.js", "content.js", "options.html", "options.js",
  "icons\icon16.png", "icons\icon32.png", "icons\icon48.png", "icons\icon128.png", "LICENSE"
)
$serverFiles = @(
  "start-server.bat", "start-server.ps1", "自動起動を設定する.bat", "自動起動を解除する.bat",
  "はじめにお読みください.txt", "LICENSE",
  "third_party\PLaMo-Community-License-ja.txt", "third_party\PLaMo-Community-License-en.txt"
)

# Windows PowerShell 5.1 の Compress-Archive はパス区切りに「\」を使い、Mac などで正しく展開されないため、
# .NET の ZipArchive で「/」区切り・UTF-8 ファイル名の zip を作る
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
function New-Zip([string]$srcDir, [string]$zipPath, [string]$prefix) {
  $fs = [System.IO.File]::Open($zipPath, [System.IO.FileMode]::Create)
  $za = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create, $false, [System.Text.Encoding]::UTF8)
  try {
    foreach ($f in Get-ChildItem $srcDir -Recurse -File) {
      $rel = $prefix + $f.FullName.Substring($srcDir.Length + 1).Replace('\', '/')
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($za, $f.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  } finally { $za.Dispose(); $fs.Dispose() }
}

function Build([string[]]$files, [string]$zipName, [string]$prefix) {
  $stage = Join-Path $dist "_stage"
  if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
  foreach ($f in ($files | Select-Object -Unique)) {
    $dst = Join-Path $stage $f
    New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null
    Copy-Item (Join-Path $root $f) $dst
  }
  $zip = Join-Path $dist $zipName
  New-Zip $stage $zip $prefix
  Remove-Item $stage -Recurse -Force
  return $zip
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
