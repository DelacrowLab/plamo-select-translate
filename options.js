const DEFAULTS = {
  serverMode: "single",
  baseUrl: "http://127.0.0.1:8080/v1",
  shortUrl: "http://127.0.0.1:8080/v1",
  longUrl: "http://127.0.0.1:8081/v1",
  wordThreshold: 2,
  model: "plamo-3-translate",
  apiKey: "",
  targetLang: "ja",
  altLang: "en",
  form: "",
  useTitleContext: true,
  autoTranslate: true
};
const TEXT_KEYS = ["serverMode", "baseUrl", "shortUrl", "longUrl", "model", "targetLang", "altLang", "form"];
// start-server.ps1 がサーバーに設定する合言葉(background.js と同じ値)
const LOCAL_SERVER_KEY = "plamo-select-translate";
const BOOL_KEYS = ["useTitleContext", "autoTranslate"];
const $ = (id) => document.getElementById(id);

// PLaMo 3 Translate の対応言語(よく使うものを先頭に)
const LANGS = [
  ["ja", "日本語"], ["en", "英語"], ["zh-hans", "中国語(簡体字)"], ["zh-hant", "中国語(繁体字)"],
  ["ko", "韓国語"], ["fr", "フランス語"], ["de", "ドイツ語"], ["es", "スペイン語"], ["it", "イタリア語"],
  ["ru", "ロシア語"], ["vi", "ベトナム語"], ["th", "タイ語"], ["id", "インドネシア語"], ["hi", "ヒンディー語"],
  ["ar", "アラビア語"], ["nl", "オランダ語"], ["pl", "ポーランド語"], ["ms", "マレー語"], ["tl", "タガログ語"],
  ["az", "アゼルバイジャン語"], ["be", "ベラルーシ語"], ["bg", "ブルガリア語"], ["bn", "ベンガル語"],
  ["ca", "カタルーニャ語"], ["ceb", "セブアノ語"], ["et", "エストニア語"], ["eu", "バスク語"], ["fa", "ペルシア語"],
  ["gu", "グジャラート語"], ["he", "ヘブライ語"], ["hr", "クロアチア語"], ["hu", "ハンガリー語"], ["hy", "アルメニア語"],
  ["jv", "ジャワ語"], ["ka", "ジョージア語"], ["kk", "カザフ語"], ["km", "クメール語"], ["lt", "リトアニア語"],
  ["lv", "ラトビア語"], ["ml", "マラヤーラム語"], ["mr", "マラーティー語"], ["my", "ビルマ語"], ["ne", "ネパール語"],
  ["pa", "パンジャブ語"], ["si", "シンハラ語"], ["sk", "スロバキア語"], ["sl", "スロベニア語"], ["sr", "セルビア語"],
  ["sw", "スワヒリ語"], ["ta", "タミル語"], ["te", "テルグ語"], ["ur", "ウルドゥー語"], ["uz", "ウズベク語"]
];
for (const id of ["targetLang", "altLang"]) {
  for (const [code, name] of LANGS) $(id).add(new Option(`${name} (${code})`, code));
}

// モードに応じて、入力欄を切り替える
function showMode() {
  const hybrid = $("serverMode").value === "hybrid";
  $("singleBox").hidden = hybrid;
  $("hybridBox").hidden = !hybrid;
}
$("serverMode").addEventListener("change", showMode);

// API キーは端末間で同期しないよう chrome.storage.local に保存する
Promise.all([chrome.storage.sync.get(null), chrome.storage.local.get("apiKey")]).then(async ([stored, local]) => {
  // 以前の版で sync に保存していた API キーがあれば local に移す
  if (stored.apiKey && !local.apiKey) {
    await chrome.storage.local.set({ apiKey: stored.apiKey });
    local.apiKey = stored.apiKey;
  }
  if ("apiKey" in stored) await chrome.storage.sync.remove("apiKey");
  const s = { ...DEFAULTS, ...stored };
  for (const k of TEXT_KEYS) $(k).value = s[k];
  for (const k of BOOL_KEYS) $(k).checked = s[k];
  $("apiKey").value = local.apiKey || "";
  $("wordThreshold").value = String(s.wordThreshold);
  showMode();
});

function isLocal(url) {
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
  } catch (_) { return false; }
}

// PC 以外のサーバーは https:// のみ許可する(通信内容や API キーを盗み見られないように)
function urlProblem(url) {
  let u;
  try { u = new URL(url); } catch (_) { return "URL の形式が正しくありません"; }
  if (!/^https?:$/.test(u.protocol)) return "URL は http:// か https:// で始めてください";
  if (!isLocal(url) && u.protocol !== "https:") return "PC 以外のサーバーは https:// の URL を指定してください";
  return "";
}

// 今のモードで使う接続先の一覧([表示名, URL])
function targets(v) {
  return v.serverMode === "hybrid"
    ? [["短い語句用(0.8B)", v.shortUrl], ["文章用(2B)", v.longUrl]]
    : [["サーバー", v.baseUrl]];
}

// PC 外のサーバーを使う場合だけ、そのオリジンへのアクセス許可を求める
async function ensurePermission(urls) {
  const origins = urls.filter((u) => !isLocal(u)).map((u) => new URL(u).origin + "/*");
  if (origins.length === 0) return true;
  return chrome.permissions.request({ origins: [...new Set(origins)] });
}

function readForm() {
  const v = {};
  for (const k of TEXT_KEYS) v[k] = $(k).value.trim();
  for (const k of BOOL_KEYS) v[k] = $(k).checked;
  v.baseUrl ||= DEFAULTS.baseUrl;
  v.shortUrl ||= DEFAULTS.shortUrl;
  v.longUrl ||= DEFAULTS.longUrl;
  v.model ||= DEFAULTS.model;
  v.wordThreshold = Number($("wordThreshold").value) || DEFAULTS.wordThreshold;
  return v;
}

function flash(el, text, cls) {
  el.textContent = text;
  el.className = cls || "";
}

$("save").addEventListener("click", async () => {
  const v = readForm();
  const urls = targets(v).map(([, u]) => u);
  const problem = urls.map(urlProblem).find(Boolean);
  if (problem) return flash($("msg"), problem, "ng");
  if (!(await ensurePermission(urls))) {
    return flash($("msg"), "サーバーへのアクセスが許可されなかったため保存していません", "ng");
  }
  const apiKey = $("apiKey").value.trim();
  await chrome.storage.sync.set(v);
  await chrome.storage.local.set({ apiKey });
  flash($("msg"), "保存しました", "ok");
  setTimeout(() => flash($("msg"), ""), 2000);
});

const BROKEN = /^(.)\1{5,}/; // 「&&&&&&…」のような壊れた出力

async function testServer(url, v) {
  const prompt =
    "<|plamo:tag|>dataset<|plamo:msg|>translation<|plamo:tag|>input<|plamo:msg|>Hello, world!" +
    `<|plamo:tag|>output<|plamo:key|>lang<|plamo:val|>${v.targetLang}<|plamo:msg|>`;
  const headers = { "Content-Type": "application/json" };
  headers.Authorization = "Bearer " + ($("apiKey").value.trim() || LOCAL_SERVER_KEY);
  const problem = urlProblem(url);
  if (problem) return [false, problem];
  try {
    const t0 = performance.now();
    const res = await fetch(url.replace(/\/+$/, "") + "/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: v.model, prompt, temperature: 0, max_tokens: 64,
        stop: ["<|plamo:tag|>", "<|plamo:bos|>"], add_special_tokens: true
      })
    });
    if (res.status === 401) throw new Error("接続を断られました(401)。サーバーに独自の API キーを設定している場合は、「API キー」に同じ値を入力してください。");
    if (!res.ok) throw new Error(`サーバーエラー ${res.status}`);
    const out = ((await res.json()).choices?.[0]?.text || "").trim();
    const ms = Math.round(performance.now() - t0);
    if (!out || BROKEN.test(out)) {
      return [false, `翻訳結果が正しくありません: "${out.slice(0, 30)}"(GPU を使っている場合は -ngl 0 --device none を付けて起動してください)`];
    }
    return [true, `成功: "Hello, world!" → "${out}"(${ms} ms)`];
  } catch (e) {
    return [false, e instanceof TypeError ? "接続できません。翻訳サーバーが起動しているか確認してください。" : e.message];
  }
}

$("test").addEventListener("click", async () => {
  const v = readForm();
  const list = targets(v);
  flash($("status"), "テスト中…");
  let ok;
  try { ok = await ensurePermission(list.map(([, u]) => u)); } catch (_) { ok = false; }
  if (!ok) return flash($("status"), "URL が正しくないか、サーバーへのアクセスが許可されていません", "ng");
  const results = await Promise.all(list.map(([, u]) => testServer(u, v)));
  const lines = results.map(([, msg], i) => (list.length > 1 ? `${list[i][0]}: ` : "") + msg);
  flash($("status"), lines.join("\n"), results.every(([good]) => good) ? "ok" : "ng");
});

for (const btn of document.querySelectorAll(".copy")) {
  btn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(btn.previousElementSibling.textContent);
    btn.textContent = "コピーしました";
    setTimeout(() => (btn.textContent = "コピー"), 1500);
  });
}
