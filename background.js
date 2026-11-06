// PLaMo 3 Translate をローカルサーバー経由で呼び出す。
// llama.cpp の llama-server / vLLM どちらの OpenAI 互換 /v1/completions にも対応。
const DEFAULTS = {
  serverMode: "single", // "single": 1 台のサーバー / "hybrid": 単語数で 2 台を使い分け
  baseUrl: "http://127.0.0.1:8080/v1",  // single モードの接続先
  shortUrl: "http://127.0.0.1:8080/v1", // hybrid: 短い語句用(0.8B)
  longUrl: "http://127.0.0.1:8081/v1",  // hybrid: 文章用(2B)
  wordThreshold: 2,                     // hybrid: この単語数以下なら短い語句用を使う
  model: "plamo-3-translate",
  apiKey: "",
  targetLang: "ja", // 翻訳先
  altLang: "en",    // 選択テキストがすでに翻訳先の言語だったときの翻訳先
  form: "",         // "" | "plain" | "polite"(日本語出力時の文体)
  useTitleContext: true,
  autoTranslate: true
};

const STOP = ["<|plamo:tag|>", "<|plamo:bos|>"];

// start-server.ps1 がサーバーに設定する合言葉と同じ値。
// 外部の Web ページが PC 上のサーバーを勝手に使えないようにするためのもので、秘密の鍵ではない。
const LOCAL_SERVER_KEY = "plamo-select-translate";
const MAX_CHARS = 5000;

// API キーは端末間で同期しないよう chrome.storage.local に保存する(ほかの設定は sync)
async function getSettings() {
  const [sync, local] = await Promise.all([chrome.storage.sync.get(null), chrome.storage.local.get("apiKey")]);
  const s = { ...DEFAULTS, ...sync };
  s.apiKey = local.apiKey || "";
  return s;
}

function isLoopback(url) {
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
  } catch (_) { return false; }
}

// PC 内のサーバー以外へは、通信内容が盗み見られないよう HTTPS でのみ接続する
function checkUrl(url) {
  let u;
  try { u = new URL(url); } catch (_) { throw new Error("設定画面のサーバー URL が正しくありません。"); }
  if (!isLoopback(url) && u.protocol !== "https:") {
    throw new Error("PC 以外のサーバーには https:// の URL でのみ接続できます。設定画面の URL を確認してください。");
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  // 更新時に同じ ID のメニューが残っていると重複エラーになるので、いったん全部消してから作る
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "plamo-translate",
      title: "PLaMo で翻訳",
      contexts: ["selection"]
    });
  });
  // 初回インストール時は、翻訳サーバーの準備手順が載った設定画面を開く
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "plamo-translate" && tab?.id) sendToTab(tab.id);
});

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== "translate-selection") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) sendToTab(tab.id);
});

// 拡張機能の更新前から開いているタブや chrome:// のページには、翻訳用スクリプトがいないため
// 送信に失敗する。その場合はエラーにせず無視する(ページを再読み込みすれば使える)。
function sendToTab(tabId) {
  chrome.tabs.sendMessage(tabId, { type: "translate-selection" }).catch(() => {});
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "translate") return;
  const ctrl = new AbortController();
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError; // ページ移動などで閉じられた理由を確認済みにする(警告を出さない)
    port.__closed = true;
    ctrl.abort();
  });
  port.onMessage.addListener((msg) => {
    // 受け取る内容を最低限チェックする(文字列以外や長すぎる入力は扱わない)
    if (!msg || typeof msg.text !== "string" || !msg.text.trim()) return;
    msg = {
      text: msg.text.slice(0, MAX_CHARS),
      title: typeof msg.title === "string" ? msg.title.slice(0, 200) : "",
      pageLang: typeof msg.pageLang === "string" ? msg.pageLang.slice(0, 20) : ""
    };
    streamTranslate(msg, port, ctrl.signal).catch((e) => {
      if (e.name === "AbortError") return;
      const m = e instanceof TypeError
        ? "翻訳サーバーに接続できません。翻訳サーバーが起動しているか(自動起動を設定した場合は PC の再起動後に自動で起動します)、設定画面の URL を確認してください。"
        : e.message || String(e);
      safePost(port, { error: m });
    });
  });
});

function safePost(port, m) {
  if (port.__closed) return;
  try { port.postMessage(m); } catch (_) {}
}

// ひらがな・カタカナを含めば日本語とみなす。
// 「機械翻訳」のように漢字だけのときは中国語と区別できないので、ページが日本語なら日本語とみなす。
function looksJapanese(text, pageLang) {
  if (/[぀-ヿ]/.test(text)) return true;
  const hasHan = /\p{Script=Han}/u.test(text);
  const hasLatin = /\p{Script=Latin}/u.test(text);
  return hasHan && !hasLatin && /^ja\b/i.test(pageLang || "");
}

// 入力に特殊トークン(<|plamo:...|> の形)が混ざるとプロンプト構造が壊れるので除去する。
// plamo: 以外の、<| |> で囲まれた予約トークン風の文字列も念のため除去する。
function clean(s) {
  return String(s).replace(/<\|[^<>|\s]{1,40}\|>/g, "");
}

function buildPrompt(text, title, s) {
  let target = s.targetLang;
  if (target === "ja" && looksJapanese(text, s.pageLang)) target = s.altLang;

  let p = "<|plamo:tag|>dataset<|plamo:msg|>translation";
  if (s.useTitleContext && title) {
    p += "<|plamo:tag|>context<|plamo:msg|>" + clean(title).slice(0, 200);
  }
  p += "<|plamo:tag|>input<|plamo:msg|>" + clean(text);
  p += "<|plamo:tag|>output<|plamo:key|>lang<|plamo:val|>" + target;
  if (target === "ja" && s.form) p += "<|plamo:key|>form<|plamo:val|>" + s.form;
  p += "<|plamo:msg|>";
  return p;
}

// 単語数を数える。日本語・中国語のように空白で区切らない言語も、Intl.Segmenter で単語に分ける
// (例: "Hello world" → 2、"翻訳" → 1、"機械翻訳" → 2、"今日はいい天気ですね。" → 6)
const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
function countWords(text) {
  let n = 0;
  for (const seg of segmenter.segment(text)) if (seg.isWordLike) n++;
  return n;
}

// 使う接続先を決める。hybrid では、もう一方を予備として返す
function pickServers(text, s) {
  if (s.serverMode !== "hybrid") return [s.baseUrl];
  const short = countWords(text) <= Number(s.wordThreshold || 2);
  return short ? [s.shortUrl, s.longUrl] : [s.longUrl, s.shortUrl];
}

async function streamTranslate({ text, title, pageLang }, port, signal) {
  const s = await getSettings();
  s.pageLang = pageLang;
  const [primary, fallback] = pickServers(text, s);
  try {
    await streamFrom(primary, text, title, s, port, signal);
  } catch (e) {
    // 使い分けモードで片方のサーバーが動いていないときは、もう片方で翻訳する
    if (fallback && e instanceof TypeError && !port.__gotText) {
      await streamFrom(fallback, text, title, s, port, signal);
    } else {
      throw e;
    }
  }
}

async function streamFrom(baseUrl, text, title, s, port, signal) {
  checkUrl(baseUrl);
  const headers = { "Content-Type": "application/json" };
  // API キーが未設定なら、start-server.ps1 で起動したサーバー用の合言葉を送る
  headers.Authorization = "Bearer " + (s.apiKey || LOCAL_SERVER_KEY);

  const res = await fetch(baseUrl.replace(/\/+$/, "") + "/completions", {
    method: "POST",
    signal,
    headers,
    body: JSON.stringify({
      model: s.model,
      prompt: buildPrompt(text, title, s),
      stream: true,
      temperature: 0,
      max_tokens: 2048,
      stop: STOP,
      add_special_tokens: true // vLLM 用(BOS を付与)。llama-server では無視される
    })
  });

  if (res.status === 401) {
    throw new Error("翻訳サーバーに接続を断られました(401)。サーバーに独自の API キーを設定している場合は、設定画面の「API キー」に同じ値を入力してください。");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`サーバーエラー ${res.status}: ${body.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const data = t.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const piece = JSON.parse(data).choices?.[0]?.text;
        if (piece) { port.__gotText = true; safePost(port, { delta: piece }); }
      } catch (_) {}
    }
  }
  safePost(port, { done: true });
}
