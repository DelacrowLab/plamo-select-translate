#!/bin/bash
# クイック翻訳 - 翻訳サーバーの起動・自動起動の設定(Mac 用。Windows 版 start-server.ps1 と同じ設定)
#
#   翻訳サーバーを起動する.command  … メニューを出して、このウィンドウでサーバーを起動(閉じると停止)
#   自動起動を設定する.command      … Mac にログインしたとき、裏で自動的にサーバーを起動するよう登録
#   自動起動を解除する.command      … 自動起動の登録を消し、裏で動いているサーバーを止める
#
# 安全のための設定:
#   --host 127.0.0.1            同じ Mac からしか接続できない
#   --api-key                   合言葉のない依頼は受け付けない(拡張機能は合言葉を付けて送る)。
#                               合言葉は公開の固定値で「認証」ではなく、Web ページからの単純な依頼を防ぐ補助策。
#   --cors-origins (ダミー)     どの Web ページ(localhost 上のページを含む)にも、ブラウザからの利用を許可しない。
#                               拡張機能は Chrome のホスト権限で通信するため、この制限を受けない。
#   --no-webui --no-slots       使わない Web 画面と、処理中の内容を見られる機能を止める
#   自動起動は launchd(~/Library/LaunchAgents)に llama-server そのものを登録する
#   (このスクリプトは登録時にだけ使うので、展開したフォルダが書き換えられたり移動されたりしても影響を受けない)
# その他:
#   Mac(Apple Silicon)では GPU(Metal)で正常に翻訳できるため、Windows 版の -ngl 0 --device none は付けない
#   -c 8192                     拡張機能の用途に足りる文脈長に絞り、メモリ使用量を減らす
#   --sleep-idle-seconds        しばらく使わないとモデルをメモリから下ろす(次の翻訳で自動的に戻る)
#
# 使い方: start-server.sh [--choice 1|2] [--install | --uninstall] [--dry-run]

set -u

API_KEY="plamo-select-translate"   # 拡張機能(background.js / options.js)と同じ値
IDLE_SEC=1800                      # 0.8B: 30 分使わなければ休止
IDLE_SEC2=600                      # 2B: メモリを多く使うので 10 分使わなければ休止
NO_CORS_ORIGIN="https://plamo-select-translate.invalid"   # 実在しないオリジン(= どのページにも許可しない)
APP_DIR="$HOME/Library/Application Support/PLaMoQuickTranslate"   # ログの置き場所
AGENT_DIR="$HOME/Library/LaunchAgents"
LABEL_PREFIX="io.github.delacrowlab.plamo-quick-translate"
REPO08="pfnet/plamo-3-translate-0.8b-GGUF:Q4_K_M"
REPO2="pfnet/plamo-3-translate-2b-GGUF:Q4_K_M"
# Homebrew がない Mac では、llama.cpp の公式ビルドをこの版に固定してダウンロードする(改ざんの確認のためハッシュも固定)
LLAMA_TAG="b12110"
LOCAL_LLAMA_DIR="$APP_DIR/llama.cpp"

CHOICE=""; INSTALL=0; UNINSTALL=0; DRYRUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --choice) CHOICE="${2:-}"; shift ;;
    --install) INSTALL=1 ;;
    --uninstall) UNINSTALL=1 ;;
    --dry-run) DRYRUN=1 ;;
    *) echo "不明な引数: $1"; exit 2 ;;
  esac
  shift
done

pause_exit() {
  if [ "$DRYRUN" = 0 ] && [ -t 0 ]; then read -r -p "Enter キーで閉じます" _; fi
  exit "$1"
}

# Homebrew で入れた llama-server を優先して探す(Finder から開いたときは PATH に Homebrew が入っていないため)
find_llama_server() {
  for p in /opt/homebrew/bin/llama-server /usr/local/bin/llama-server "$LOCAL_LLAMA_DIR/llama-server"; do
    if [ -x "$p" ]; then echo "$p"; return; fi
  done
  command -v llama-server 2>/dev/null
}

# llama.cpp を $LOCAL_LLAMA_DIR に入れる。curl でのダウンロードは Mac の検疫の対象にならない
install_llama_cpp() {
  local asset sha tmp
  case "$(uname -m)" in
    arm64)  asset="llama-$LLAMA_TAG-bin-macos-arm64.tar.gz"; sha="4f5b8de12e0b9516658ca6a5764c6ffb3d7c659c3dd538556b1413c7b4050662" ;;
    x86_64) asset="llama-$LLAMA_TAG-bin-macos-x64.tar.gz";   sha="c8094268b6bf62f4998f0e45656fd9f5e2d4afb6b1cd0044d761db64be1dd47d" ;;
    *) return 1 ;;
  esac
  tmp="$(mktemp -d)" || return 1
  echo ""
  echo " 翻訳エンジン(llama.cpp)をダウンロードします。"
  if curl -fL --progress-bar -o "$tmp/llama.tar.gz" "https://github.com/ggml-org/llama.cpp/releases/download/$LLAMA_TAG/$asset" \
     && [ "$(shasum -a 256 "$tmp/llama.tar.gz" | cut -d' ' -f1)" = "$sha" ] \
     && tar -xzf "$tmp/llama.tar.gz" -C "$tmp"; then
    local server; server="$(find "$tmp" -type f -name llama-server | head -1)"
    if [ -n "$server" ]; then
      rm -rf "$LOCAL_LLAMA_DIR"
      mkdir -p "$APP_DIR"
      mv "$(dirname "$server")" "$LOCAL_LLAMA_DIR"
      rm -rf "$tmp"
      return 0
    fi
  fi
  rm -rf "$tmp"
  return 1
}

# 0.8B は常にポート 8080、2B は常にポート 8081 で動かす。どのモデルで翻訳するかは拡張機能の設定画面で選ぶ。
server_args() {   # $1=repo $2=port $3=idle
  echo "-hf $1 --host 127.0.0.1 --port $2 --api-key $API_KEY --cors-origins $NO_CORS_ORIGIN --no-webui --no-slots -c 8192 --sleep-idle-seconds $3"
}

port_in_use() { nc -z -G 1 127.0.0.1 "$1" >/dev/null 2>&1; }

# このツールが起動した llama-server(この合言葉付きで PLaMo を動かしているもの)だけを止める
stop_our_servers() {
  pgrep -f "llama-server.*--api-key $API_KEY" | while read -r pid; do
    if ps -o command= -p "$pid" | grep -q "plamo-3-translate"; then kill "$pid" 2>/dev/null && echo "$pid"; fi
  done
}

unload_agents() {
  for port in 8080 8081; do
    local label="$LABEL_PREFIX.$port" plist="$AGENT_DIR/$LABEL_PREFIX.$port.plist"
    launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1
    if [ -f "$plist" ]; then rm -f "$plist"; echo "removed"; fi
  done
}

xml_escape() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' <<<"$1"; }

write_agent() {   # $1=port $2..=llama-server と引数
  local port="$1"; shift
  local label="$LABEL_PREFIX.$port" plist="$AGENT_DIR/$LABEL_PREFIX.$port.plist"
  {
    echo '<?xml version="1.0" encoding="UTF-8"?>'
    echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    echo '<plist version="1.0"><dict>'
    echo "  <key>Label</key><string>$label</string>"
    echo '  <key>ProgramArguments</key><array>'
    for a in "$@"; do echo "    <string>$(xml_escape "$a")</string>"; done
    echo '  </array>'
    echo '  <key>RunAtLoad</key><true/>'
    echo '  <key>ProcessType</key><string>Background</string>'
    echo "  <key>StandardOutPath</key><string>$(xml_escape "$APP_DIR/server-$port.out.log")</string>"
    echo "  <key>StandardErrorPath</key><string>$(xml_escape "$APP_DIR/server-$port.log")</string>"
    echo '</dict></plist>'
  } > "$plist"
  launchctl bootstrap "gui/$(id -u)" "$plist"
}

ask_choice() {
  echo ""
  echo " $1 モデルを選んでください:"
  echo ""
  echo "   1. 0.8B のみ      … 速くて軽い(ダウンロード 約 0.6 GB) ※おすすめ"
  echo "   2. 0.8B と 2B     … 拡張機能の設定画面で 0.8B / 2B / 使い分け を自由に切り替えられる"
  echo "                       (ダウンロード 約 2.4 GB)"
  echo ""
  echo "   どちらも、しばらく翻訳しないとモデルをメモリから下ろします。"
  echo "   翻訳中のメモリは 0.8B が約 1.1 GB、2B が約 3.7 GB です。"
  echo ""
  read -r -p "番号を入力して Enter(そのまま Enter で 1): " c
  CHOICE="${c:-1}"
}

# ---------- 自動起動の解除 ----------
if [ "$UNINSTALL" = 1 ]; then
  if [ -n "$(unload_agents)" ]; then echo "自動起動の登録を解除しました。"; else echo "自動起動は登録されていませんでした。"; fi
  if [ -n "$(stop_our_servers)" ]; then echo "動いていた翻訳サーバーを止めました。"; fi
  pause_exit 0
fi

EXE="$(find_llama_server)"
if [ -z "$EXE" ] && [ "$DRYRUN" = 0 ]; then
  if install_llama_cpp; then EXE="$(find_llama_server)"; fi
fi
if [ -z "$EXE" ] && [ "$DRYRUN" = 0 ]; then
  echo "翻訳エンジン(llama.cpp)をインストールできませんでした。"
  echo "インターネットにつながっているか確かめて、もう一度開いてください。"
  pause_exit 1
fi

if [ -z "$CHOICE" ]; then
  if [ "$INSTALL" = 1 ]; then ask_choice "自動起動する"; else ask_choice "使う"; fi
fi
case "$CHOICE" in
  1) SERVERS=("0.8B 8080 $REPO08 $IDLE_SEC") ;;
  2|3) SERVERS=("0.8B 8080 $REPO08 $IDLE_SEC" "2B 8081 $REPO2 $IDLE_SEC2") ;;
  *) echo "1 か 2 を入力してください。"; pause_exit 1 ;;
esac

if [ "$DRYRUN" = 1 ]; then
  for s in "${SERVERS[@]}"; do set -- $s; echo "RUN ${EXE:-llama-server} $(server_args "$3" "$2" "$4")"; done
  exit 0
fi

# ---------- 自動起動の登録 ----------
if [ "$INSTALL" = 1 ]; then
  mkdir -p "$APP_DIR" "$AGENT_DIR"
  unload_agents >/dev/null      # 以前の登録を消してから登録し直す(0.8B のみ ⇔ 0.8B と 2B の切り替えに対応)
  stop_our_servers >/dev/null   # 手動で起動したものが動いていれば止めて、選んだ設定で起動し直す
  sleep 0.5
  for s in "${SERVERS[@]}"; do
    set -- $s
    if port_in_use "$2"; then echo "ポート $2 を別のアプリが使っているため、$1 の翻訳サーバーを登録できませんでした。"; continue; fi
    # shellcheck disable=SC2046
    write_agent "$2" "$EXE" $(server_args "$3" "$2" "$4")
  done
  echo ""
  echo "自動起動を登録しました。次回から Mac にログインすると、翻訳サーバーが裏で起動します。"
  echo "今回もすでに裏で起動しています。初回はモデルのダウンロードに数分かかります。"
  echo "拡張機能の設定画面の「接続テスト」で確認できます。(記録: $APP_DIR)"
  pause_exit 0
fi

# ---------- このウィンドウで起動 ----------
for s in "${SERVERS[@]}"; do
  set -- $s
  if port_in_use "$2"; then
    echo "ポート $2 はすでに使われています。"
    echo "翻訳サーバーが自動起動で裏で動いている場合は、このウィンドウを開く必要はありません。"
    echo "そうでない場合は、ほかのアプリがポート $2 を使っています。"
    pause_exit 1
  fi
done
echo ""
echo " 翻訳サーバーを起動します。初回はモデルのダウンロードに数分かかります。"
echo " 使用するプログラム: $EXE"
echo " 「listening on http://127.0.0.1:8080」(2B も使う場合は「…:8081」も)と表示されたら準備完了です。"
echo " このウィンドウは閉じずにおいてください(閉じるとサーバーも止まります)。"
echo ""

BG=()
trap 'for p in "${BG[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done' EXIT
for s in "${SERVERS[@]:1}"; do
  set -- $s
  # shellcheck disable=SC2046
  "$EXE" $(server_args "$3" "$2" "$4") &
  BG+=($!)
done
set -- ${SERVERS[0]}
# shellcheck disable=SC2046
"$EXE" $(server_args "$3" "$2" "$4")
echo "サーバーが停止しました。"
pause_exit 0
