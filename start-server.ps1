# PLaMo 選択翻訳 - 翻訳サーバーの起動・自動起動の設定
#
#   start-server.bat            … メニューを出して、このウィンドウでサーバーを起動(閉じると停止)
#   自動起動を設定する.bat      … PC にサインインしたとき、裏で自動的にサーバーを起動するよう登録
#   自動起動を解除する.bat      … 自動起動の登録を消し、裏で動いているサーバーを止める
#
# 安全のための設定:
#   --host 127.0.0.1            同じ PC からしか接続できない
#   --api-key                   合言葉のない依頼は受け付けない(拡張機能は合言葉を付けて送る)。
#                               合言葉は公開の固定値で「認証」ではなく、Web ページからの単純な依頼を防ぐ補助策。
#   --cors-origins (ダミー)     どの Web ページ(localhost 上のページを含む)にも、ブラウザからの利用を許可しない。
#                               拡張機能は Chrome のホスト権限で通信するため、この制限を受けない。
#   --no-webui --no-slots       使わない Web 画面と、処理中の内容を見られる機能を止める
#   自動起動は、このスクリプトを %LOCALAPPDATA%\PLaMoSelectTranslate にコピーし、そこから起動する
#   (展開したフォルダが書き換えられたり移動されたりしても、自動起動が影響を受けないように)
# その他:
#   -ngl 0 --device none        一部の GPU(Snapdragon の Adreno など)で翻訳結果が壊れるため、CPU のみで動かす
#   -c 8192                     拡張機能の用途に足りる文脈長に絞り、メモリ使用量を減らす
#   --sleep-idle-seconds        しばらく使わないとモデルをメモリから下ろす(次の翻訳で自動的に戻る)
param(
  [string]$Choice = "",   # "1" / "2" / "3" を渡すとメニューを省略
  [switch]$Background,    # 裏で起動してすぐ終わる(自動起動用)
  [switch]$Install,       # 自動起動を登録する
  [switch]$Uninstall,     # 自動起動を解除し、サーバーを止める
  [switch]$DryRun,        # 実行せずにコマンドだけ表示(動作確認用)
  [string]$ShortcutPath = ""  # 動作確認用: 自動起動のショートカットの作成先を変える
)

$ErrorActionPreference = "Stop"
$ApiKey   = "plamo-select-translate"   # 拡張機能(background.js / options.js)と同じ値
$IdleSec  = 1800                       # 30 分使わなければ休止
$AppDir   = Join-Path $env:LOCALAPPDATA "PLaMoSelectTranslate"
$AppScript = Join-Path $AppDir "start-server.ps1"   # 自動起動で実行するコピー
$NoCorsOrigin = "https://plamo-select-translate.invalid"   # 実在しないオリジン(= どのページにも許可しない)
$Shortcut = if ($ShortcutPath) { $ShortcutPath } else { Join-Path ([Environment]::GetFolderPath("Startup")) "PLaMo 選択翻訳サーバー.lnk" }
$repo08   = "pfnet/plamo-3-translate-0.8b-GGUF:Q4_K_M"
$repo2    = "pfnet/plamo-3-translate-2b-GGUF:Q4_K_M"

function Pause-Exit([int]$code) {
  if (-not $Background -and -not $DryRun) { Read-Host "Enter キーで閉じます" | Out-Null }
  exit $code
}

# winget で入れた llama-server を優先して探す(インストール直後で PATH が未反映でも見つかる)。
# 画面に使用パスを表示できる対話起動のときだけ、PATH 上の llama-server も候補にする
# (画面に出ない自動起動では、PATH に置かれた別の実行ファイルを使わないため)。
function Find-LlamaServer([bool]$allowPath) {
  $pkg = Get-ChildItem (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages") -Directory -Filter "ggml.llamacpp_*" -ErrorAction SilentlyContinue |
         ForEach-Object { Join-Path $_.FullName "llama-server.exe" } | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($pkg) { return $pkg }
  if ($allowPath) {
    $cmd = Get-Command llama-server -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
  }
  return $null
}

function Write-Log([string]$msg) {
  New-Item -ItemType Directory -Force $AppDir | Out-Null
  Add-Content -Path (Join-Path $AppDir "autostart.log") -Value ("{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $msg) -Encoding UTF8
}

function Server-Args([string]$repo, [int]$port) {
  return @("-hf", $repo, "--host", "127.0.0.1", "--port", "$port",
           "--api-key", $ApiKey, "--cors-origins", $NoCorsOrigin, "--no-webui", "--no-slots",
           "-ngl", "0", "--device", "none", "-c", "8192", "--sleep-idle-seconds", "$IdleSec")
}

function Servers-For([string]$c) {
  switch ($c) {
    "1" { return ,@(@{ Label = "0.8B"; Port = 8080; Args = (Server-Args $repo08 8080) }) }
    "2" { return ,@(@{ Label = "2B";   Port = 8080; Args = (Server-Args $repo2 8080) }) }
    "3" { return @(@{ Label = "0.8B"; Port = 8080; Args = (Server-Args $repo08 8080) },
                   @{ Label = "2B";   Port = 8081; Args = (Server-Args $repo2 8081) }) }
    default { return $null }
  }
}

function Port-InUse([int]$port) {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $ok = $c.ConnectAsync("127.0.0.1", $port).Wait(300)
    $c.Close()
    return $ok
  } catch { return $false }
}

# このツールが起動した llama-server(この合言葉付きで起動したもの)だけを探す。
# 同じモデルを別の設定で動かしている llama-server は対象にしない。
function Get-OurServers {
  Get-CimInstance Win32_Process -Filter "Name='llama-server.exe'" |
    Where-Object { $_.CommandLine -match [regex]::Escape("--api-key $ApiKey") -and $_.CommandLine -match "plamo-3-translate" }
}

function Stop-OurServers {
  Get-OurServers | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId }
}

function Ask-Choice([string]$purpose) {
  Write-Host ""
  Write-Host " $purpose モデルを選んでください:"
  Write-Host ""
  Write-Host "   1. 0.8B のみ … 速くて軽い(ダウンロード 約 0.6 GB、使用中のメモリ 約 1.1 GB) ※おすすめ"
  Write-Host "   2. 2B のみ   … 訳文が少し自然・速度は約半分(ダウンロード 約 1.8 GB、使用中のメモリ 約 3.7 GB)"
  Write-Host "   3. 使い分け  … 短い語句は 0.8B、文章は 2B(ダウンロード 約 2.4 GB、使用中のメモリ 約 4.8 GB)"
  Write-Host "                  ※ 拡張機能の設定画面で「使い分ける」モードを選んでください"
  Write-Host ""
  $c = Read-Host "番号を入力して Enter(そのまま Enter で 1)"
  if (-not $c) { $c = "1" }
  return $c.Trim()
}

# ---------- 自動起動の解除 ----------
if ($Uninstall) {
  if (Test-Path $Shortcut) { Remove-Item $Shortcut -Force; Write-Host "自動起動の登録を解除しました。" }
  else { Write-Host "自動起動は登録されていませんでした。" }
  if ((Test-Path $AppScript) -and ($AppScript -ne $PSCommandPath)) { Remove-Item $AppScript -Force -ErrorAction SilentlyContinue }
  $stopped = @(Stop-OurServers)
  if ($stopped.Count) { Write-Host "動いていた翻訳サーバーを止めました。" }
  Pause-Exit 0
}

$Host.UI.RawUI.WindowTitle = "PLaMo 選択翻訳 - 翻訳サーバー"
$exe = Find-LlamaServer (-not $Background)
if (-not $exe -and -not $DryRun) {
  if ($Background) { Write-Log "llama-server が見つからないため起動できませんでした(winget install llama.cpp が必要です)"; exit 1 }
  Write-Host "llama-server が見つかりません。" -ForegroundColor Red
  Write-Host "ターミナルで「winget install llama.cpp」を実行してから、もう一度開いてください。"
  Pause-Exit 1
}

if (-not $Choice -and -not $Background) {
  $Choice = Ask-Choice $(if ($Install) { "自動起動する" } else { "使う" })
}
if (-not $Choice) { $Choice = "1" }
$servers = Servers-For $Choice
if (-not $servers) {
  Write-Host "1・2・3 のどれかを入力してください。" -ForegroundColor Red
  Pause-Exit 1
}

if ($DryRun) {
  foreach ($s in $servers) { Write-Host "RUN $exe $($s.Args -join ' ')" }
  exit 0
}

# ---------- 自動起動の登録 ----------
if ($Install) {
  # このスクリプトを専用フォルダにコピーし、自動起動ではコピーの方を実行する
  New-Item -ItemType Directory -Force $AppDir | Out-Null
  if ($PSCommandPath -ne $AppScript) { Copy-Item $PSCommandPath $AppScript -Force }
  $ws = New-Object -ComObject WScript.Shell
  $lnk = $ws.CreateShortcut($Shortcut)
  $lnk.TargetPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  # -ExecutionPolicy Bypass: 既定の実行ポリシーでは .ps1 を実行できない PC が多いため、このスクリプトに限って許可する
  $lnk.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$AppScript`" -Background -Choice $Choice"
  $lnk.WindowStyle = 7   # 最小化で起動(画面に出さない)
  $lnk.Description = "PLaMo 選択翻訳の翻訳サーバーを裏で起動します"
  $lnk.Save()
  Stop-OurServers | Out-Null   # 以前の設定で動いているサーバーがあれば止めて、選んだ設定で起動し直す
  Start-Sleep -Milliseconds 500
  Write-Host ""
  Write-Host "自動起動を登録しました。次回から PC にサインインすると、翻訳サーバーが裏で起動します。" -ForegroundColor Green
  Write-Host "今回はこのまま裏で起動します。"
  $Background = $true
}

# ---------- 裏で起動(自動起動用) ----------
if ($Background) {
  New-Item -ItemType Directory -Force $AppDir | Out-Null
  foreach ($s in $servers) {
    if (Port-InUse $s.Port) {
      # すでにこのツールのサーバーが動いていれば何もしない。別のアプリが使っている場合はログに残す
      $ours = @(Get-OurServers | Where-Object { $_.CommandLine -match "--port $($s.Port)(\s|$)" })
      if (-not $ours.Count) { Write-Log "ポート $($s.Port) を別のアプリが使っているため、$($s.Label) の翻訳サーバーを起動できませんでした" }
      continue
    }
    Write-Log "$($s.Label) の翻訳サーバーを起動しました(ポート $($s.Port)、$exe)"
    Start-Process -FilePath $exe -ArgumentList $s.Args -WindowStyle Hidden `
      -RedirectStandardError (Join-Path $AppDir "server-$($s.Port).log") `
      -RedirectStandardOutput (Join-Path $AppDir "server-$($s.Port).out.log") | Out-Null
  }
  if ($Install) {
    Write-Host "初回はモデルのダウンロードに数分かかります。拡張機能の設定画面の「接続テスト」で確認できます。"
    $Background = $false
    Pause-Exit 0
  }
  exit 0
}

# ---------- このウィンドウで起動 ----------
foreach ($s in $servers) {
  if (Port-InUse $s.Port) {
    Write-Host "ポート $($s.Port) はすでに使われています。" -ForegroundColor Yellow
    Write-Host "翻訳サーバーが自動起動で裏で動いている場合は、このウィンドウを開く必要はありません。"
    Write-Host "そうでない場合は、ほかのアプリがポート $($s.Port) を使っています。"
    Pause-Exit 1
  }
}
Write-Host ""
Write-Host " $(($servers | ForEach-Object { $_.Label }) -join ' と ') を起動します。初回はモデルのダウンロードに数分かかります。"
Write-Host " 使用するプログラム: $exe"
if ($servers.Count -eq 1) {
  Write-Host " 「listening on http://127.0.0.1:8080」と表示されたら準備完了です。"
} else {
  Write-Host " 「listening on http://127.0.0.1:8080」と「…:8081」の両方が表示されたら準備完了です。"
}
Write-Host " このウィンドウは閉じずにおいてください(閉じるとサーバーも止まります)。"
Write-Host ""

$bg = @()
try {
  foreach ($s in ($servers | Select-Object -Skip 1)) {
    $bg += Start-Process -FilePath $exe -ArgumentList $s.Args -NoNewWindow -PassThru
  }
  $first = $servers[0].Args
  & $exe @first
} finally {
  foreach ($p in $bg) { if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } }
}
Read-Host "サーバーが停止しました。Enter キーで閉じます" | Out-Null
