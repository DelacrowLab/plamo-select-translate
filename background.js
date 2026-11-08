importScripts("shared.js");

// PLaMo 3 Translate をローカルサーバー経由で呼び出す。
// llama.cpp の llama-server / vLLM どちらの OpenAI 互換 /v1/completions にも対応。
const DEFAULTS = {
  modelMode: "0.8b",                    // "0.8b" / "2b" / "hybrid"(単語数で使い分け)
  shortUrl: "http://127.0.0.1:8080/v1", // 0.8B のサーバー
  longUrl: "http://127.0.0.1:8081/v1",  // 2B のサーバー
  wordThreshold: 2,                     // hybrid: この単語数以下なら 0.8B を使う
  model: "plamo-3-translate",
  apiKey: "",
  targetLang: "ja", // 翻訳先
  altLang: "",      // 選択テキストが日本語だったときの翻訳先("" = 翻訳しない)
  skipLangs: [],    // 翻訳しない言語(初期設定は、なし = 何でも翻訳する)
  keepTerms: "",    // 翻訳せずに残す語(1 行に 1 語)
  autoKeepNames: false, // 文の途中で大文字から始まる語も残す
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
  const s = { ...DEFAULTS, ...migrateSettings(sync) };
  s.apiKey = local.apiKey || "";
  return s;
}

// 1.2.x までの設定(serverMode: "single" / "hybrid"、single の接続先 baseUrl)を新しい形に読み替える
function migrateSettings(sync) {
  const s = { ...sync };
  if (!s.modelMode) {
    if (s.serverMode === "hybrid") s.modelMode = "hybrid";
    else {
      // 1.2.x の single モードでは baseUrl が実際の接続先(shortUrl は使われていなかった)
      s.modelMode = "0.8b";
      if (s.baseUrl) s.shortUrl = s.baseUrl;
    }
  }
  return s;
}

function isLoopback(url) {
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h === "127.0.0.1"; // manifest の host_permissions と同じ範囲
  } catch (_) { return false; }
}

// PC 内のサーバー以外へは、通信内容が盗み見られないよう HTTPS でのみ接続する
function checkUrl(url) {
  let u;
  try { u = new URL(url); } catch (_) { throw new Error("設定画面のサーバー URL が正しくありません。"); }
  if (isLoopback(url) && u.protocol !== "http:") {
    throw new Error("PC 内のサーバーは http://127.0.0.1:ポート番号/v1 の形で指定してください。");
  }
  if (!isLoopback(url) && u.protocol !== "https:") {
    throw new Error("PC 以外のサーバーには https:// の URL でのみ接続できます。設定画面の URL を確認してください。");
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  // 更新時に同じ ID のメニューが残っていると重複エラーになるので、いったん全部消してから作る
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "plamo-translate",
      title: "クイック翻訳で翻訳",
      contexts: ["selection"]
    });
  });
  // 初回インストール時は、翻訳サーバーの準備手順が載った設定画面を開く
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "plamo-translate" && tab?.id) sendToTab(tab.id, info.selectionText, info.frameId);
});

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== "translate-selection") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) sendToTab(tab.id);
});

// 拡張機能の更新前から開いているタブや PDF ビューアーなど、ページの中に表示できないときは、
// 右クリックメニューが渡してくれた文章を小さなウィンドウで翻訳する(ショートカットでは文章を受け取れないので何もしない)。
async function sendToTab(tabId, selectionText, frameId) {
  const message = { type: "translate-selection", selectionText };
  const send = (options) => chrome.tabs.sendMessage(tabId, message, options).catch(() => false);
  // 右クリックされたフレームに頼む。PDF ビューアーの枠には翻訳用スクリプトがいないので、受け持てなければタブ全体に頼む
  const handled = (frameId !== undefined && await send({ frameId })) || await send();
  if (!handled && selectionText) openResultWindow(selectionText);
}

// 別ウィンドウに渡す文章は、受け取られるまでメモリにだけ置く
const pendingResults = new Map();

async function openResultWindow(text) {
  const id = crypto.randomUUID();
  pendingResults.set(id, text.slice(0, MAX_CHARS));
  try {
    await chrome.windows.create({ url: `result.html?id=${id}`, type: "popup", width: 520, height: 340 });
  } catch (_) {
    pendingResults.delete(id);
  }
}

chrome.runtime.onMessage.addListener((m, sender, respond) => {
  if (m.type !== "take-result" || !sender.url?.startsWith(chrome.runtime.getURL("result.html"))) return;
  respond(pendingResults.get(m.id) || "");
  pendingResults.delete(m.id);
});

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
        ? "翻訳サーバーに接続できません。設定した直後や PC の起動直後は、モデルの準備に数分かかります。少し待ってもつながらないときは、設定画面の「接続テスト」で確認してください。"
        : e.message || String(e);
      safePost(port, { error: m });
    });
  });
});

function safePost(port, m) {
  if (port.__closed) return;
  try { port.postMessage(m); } catch (_) {}
}

// 入力に特殊トークン(<|plamo:...|> の形)が混ざるとプロンプト構造が壊れるので除去する。
// plamo: 以外の、<| |> で囲まれた予約トークン風の文字列も念のため除去する。
// 取り除いた結果つながって新しいトークンができないよう、なくなるまで繰り返す。
function clean(s) {
  let out = String(s), prev;
  do {
    prev = out;
    out = out.replace(/<\|[^<>|\s]{1,40}\|>/g, "");
  } while (out !== prev);
  return out;
}

// 大文字で始まる語のうち、普段から訳す語(月・曜日)は自動では残さない
const COMMON_CAPITALIZED = /^(I|January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/;

// 翻訳せずに残す語を、文章に出てくる綴りのまま集める。モデルの用語集に「元の語 → 元の語」で渡す
function keepTerms(text, s) {
  const terms = new Set();
  for (const line of String(s.keepTerms || "").split("\n")) {
    const term = clean(line).trim();
    if (!term) continue;
    const escaped = term.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    const re = new RegExp(`(?<![\\p{Script=Latin}\\p{N}])${escaped}(?![\\p{Script=Latin}\\p{N}])`, "giu");
    for (const m of text.matchAll(re)) terms.add(m[0]);
  }
  // ドイツ語は名詞がすべて大文字で始まるので対象にしない
  if (s.autoKeepNames && !/^de\b/i.test(s.pageLang || "")) {
    for (const m of text.matchAll(/\p{Lu}[\p{L}\p{N}'’-]+/gu)) {
      const before = text.slice(0, m.index).trimEnd();
      if (before && !/[.!?。!?:;"“(\n]$/.test(before) && !COMMON_CAPITALIZED.test(m[0])) terms.add(m[0]);
    }
  }
  return [...terms].slice(0, 50);
}

function buildPrompt(text, title, s, target) {

  let p = "<|plamo:tag|>dataset<|plamo:msg|>translation";
  if (s.useTitleContext && title) {
    p += "<|plamo:tag|>context<|plamo:msg|>" + clean(title).slice(0, 200);
  }
  const terms = keepTerms(clean(text), s);
  if (terms.length) p += "<|plamo:tag|>glossary" + terms.map((t) => `<|plamo:index|>${t}<|plamo:item|>${t}`).join("");
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

// 使う接続先を決める。[使うサーバー, 予備]。
// 2B のサーバーが動いていない(「0.8B のみ」で起動した)ときは、0.8B で翻訳する
function pickServers(text, s) {
  if (s.modelMode === "2b") return [s.longUrl, s.shortUrl];
  if (s.modelMode === "hybrid") {
    const short = countWords(text) <= Number(s.wordThreshold || 2);
    return short ? [s.shortUrl, s.longUrl] : [s.longUrl, s.shortUrl];
  }
  return [s.shortUrl];
}

const SKIP_MESSAGES = {
  numbers: "数字だけの選択は翻訳しません。",
  japanese: "日本語の文章は翻訳しない設定です(設定画面の「選択テキストが日本語だったときの翻訳先」で変更できます)。",
  language: "この言語は翻訳しない設定です(設定画面の「翻訳する言語」で変更できます)。"
};

async function streamTranslate({ text, title, pageLang }, port, signal) {
  const s = await getSettings();
  s.pageLang = pageLang;
  // 翻訳しない文章なら、サーバーに送らずに理由を知らせる
  const { target, reason } = await decideTarget(text, s, pageLang);
  if (!target) { safePost(port, { skip: true, message: SKIP_MESSAGES[reason] }); return; }
  const [primary, fallback] = pickServers(text, s);
  try {
    await streamFrom(primary, text, title, s, port, signal, target);
  } catch (e) {
    // 選んだモデルのサーバーが動いていないときは、もう片方で翻訳し、そのことをパネルに表示する
    if (fallback && e instanceof TypeError && !port.__gotText) {
      const label = (url) => (url === s.longUrl ? "2B" : "0.8B");
      safePost(port, { note: `${label(primary)} のサーバーに接続できないため、${label(fallback)} で翻訳しました。` });
      await streamFrom(fallback, text, title, s, port, signal, target);
    } else {
      throw e;
    }
  }
}

async function streamFrom(baseUrl, text, title, s, port, signal, target) {
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
      prompt: buildPrompt(text, title, s, target),
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
  if (res.status === 503) throw new Error("翻訳サーバーがモデルを準備しています。少し待ってからもう一度お試しください。");
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
