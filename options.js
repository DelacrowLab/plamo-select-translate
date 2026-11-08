const DEFAULTS = {
  modelMode: "0.8b",
  shortUrl: "http://127.0.0.1:8080/v1",
  longUrl: "http://127.0.0.1:8081/v1",
  wordThreshold: 2,
  model: "plamo-3-translate",
  apiKey: "",
  targetLang: "ja",
  altLang: "", // "" = 日本語の文章は翻訳しない
  skipLangs: [], // 翻訳しない言語(初期設定は、なし = 何でも翻訳する)
  keepTerms: "",
  autoKeepNames: false,
  form: "",
  useTitleContext: true,
  autoTranslate: true
};
const TEXT_KEYS = ["modelMode", "shortUrl", "longUrl", "model", "targetLang", "altLang", "form", "keepTerms"];
// start-server.ps1 がサーバーに設定する合言葉(background.js と同じ値)
const LOCAL_SERVER_KEY = "plamo-select-translate";
const BOOL_KEYS = ["useTitleContext", "autoTranslate", "autoKeepNames"];
const $ = (id) => document.getElementById(id);

$("altLang").add(new Option("なし(翻訳しない)", ""));
for (const id of ["targetLang", "altLang"]) {
  for (const [code, name] of LANGS) $(id).add(new Option(`${name} (${code})`, code));
}

// 「翻訳する言語」のチェックボックスを作る
for (const [code, name] of LANGS) {
  const label = document.createElement("label");
  const box = document.createElement("input");
  box.type = "checkbox";
  box.value = code;
  const text = document.createElement("span");
  text.textContent = name;
  label.append(box, " ", text);
  $("sourceLangs").append(label);
}
const sourceBoxes = () => [...$("sourceLangs").querySelectorAll("input")];

// 翻訳先と同じ言語は選べないようにして、選択中の言語を表示する
function refreshSourceLangs() {
  const target = $("targetLang").value;
  const names = [], off = [];
  for (const box of sourceBoxes()) {
    const name = LANGS.find(([code]) => code === box.value)[1];
    const isTarget = box.value === target;
    box.disabled = isTarget;
    box.nextElementSibling.textContent = isTarget ? `${name}(翻訳先)` : name;
    if (!isTarget) (box.checked ? names : off).push(name);
  }
  $("sourceSummary").textContent = !names.length ? "選択されていません"
    : !off.length ? "すべての言語を翻訳します"
    : `翻訳しない言語: ${off.slice(0, 5).join("、")}${off.length > 5 ? ` ほか ${off.length - 5} 言語` : ""}`;
}
$("sourceLangs").addEventListener("change", refreshSourceLangs);
$("targetLang").addEventListener("change", refreshSourceLangs);
for (const [id, checked] of [["sourceAll", true], ["sourceNone", false]]) {
  $(id).addEventListener("click", () => {
    for (const box of sourceBoxes()) box.checked = checked;
    refreshSourceLangs();
  });
}

// モードに応じて、入力欄を切り替える
function showMode() {
  $("hybridBox").hidden = $("modelMode").value !== "hybrid";
}
$("modelMode").addEventListener("change", showMode);

// 1.2.x までの設定(serverMode / baseUrl)を新しい形に読み替える(background.js と同じ)
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

// API キーは端末間で同期しないよう chrome.storage.local に保存する
Promise.all([chrome.storage.sync.get(null), chrome.storage.local.get("apiKey")]).then(async ([stored, local]) => {
  // 以前の版で sync に保存していた API キーがあれば local に移す
  if (stored.apiKey && !local.apiKey) {
    await chrome.storage.local.set({ apiKey: stored.apiKey });
    local.apiKey = stored.apiKey;
  }
  if ("apiKey" in stored) await chrome.storage.sync.remove("apiKey");
  const s = { ...DEFAULTS, ...migrateSettings(stored) };
  for (const k of TEXT_KEYS) $(k).value = s[k];
  for (const k of BOOL_KEYS) $(k).checked = s[k];
  $("apiKey").value = local.apiKey || "";
  $("wordThreshold").value = String(s.wordThreshold);
  for (const box of sourceBoxes()) box.checked = !s.skipLangs.includes(box.value);
  showMode();
  refreshSourceLangs();
});

function isLocal(url) {
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h === "127.0.0.1"; // manifest の host_permissions と同じ範囲
  } catch (_) { return false; }
}

// PC 以外のサーバーは https:// のみ許可する(通信内容や API キーを盗み見られないように)
function urlProblem(url) {
  let u;
  try { u = new URL(url); } catch (_) { return "URL の形式が正しくありません"; }
  if (!/^https?:$/.test(u.protocol)) return "URL は http:// か https:// で始めてください";
  if (isLocal(url) && u.protocol !== "http:") return "PC 内のサーバーは http://127.0.0.1:ポート番号/v1 の形で指定してください";
  if (!isLocal(url) && u.protocol !== "https:") return "PC 以外のサーバーは https:// の URL を指定してください(PC 内は 127.0.0.1 か localhost)";
  return "";
}

// 今のモードで使う接続先の一覧([表示名, URL])
function targets(v) {
  if (v.modelMode === "hybrid") return [["0.8B", v.shortUrl], ["2B", v.longUrl]];
  if (v.modelMode === "2b") return [["2B", v.longUrl]];
  return [["0.8B", v.shortUrl]];
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
  v.shortUrl ||= DEFAULTS.shortUrl;
  v.longUrl ||= DEFAULTS.longUrl;
  v.model ||= DEFAULTS.model;
  v.wordThreshold = Number($("wordThreshold").value) || DEFAULTS.wordThreshold;
  v.skipLangs = sourceBoxes().filter((box) => !box.checked).map((box) => box.value);
  return v;
}

function flash(el, text, cls) {
  el.textContent = text;
  el.className = cls || "";
}

$("save").addEventListener("click", async () => {
  const v = readForm();
  if (!sourceBoxes().some((box) => box.checked && box.value !== v.targetLang)) {
    return flash($("msg"), "「翻訳する言語」を 1 つ以上選んでください(翻訳先と同じ言語は数えません)", "ng");
  }
  const urls = targets(v).map(([, u]) => u);
  const problem = urls.map(urlProblem).find(Boolean);
  if (problem) return flash($("msg"), problem, "ng");
  if (!(await ensurePermission(urls))) {
    return flash($("msg"), "サーバーへのアクセスが許可されなかったため保存していません", "ng");
  }
  const apiKey = $("apiKey").value.trim();
  await chrome.storage.sync.set(v);
  await chrome.storage.sync.remove(["serverMode", "baseUrl", "sourceLangs"]); // 1.2.x までの古い設定は消す
  await chrome.storage.local.set({ apiKey });
  flash($("msg"), "保存しました", "ok");
  setTimeout(() => flash($("msg"), ""), 2000);
});

const NOT_CONNECTED = "接続できません。";

// つながらないときの案内。翻訳サーバーのセットの既定の接続先と、自分で指定した URL で内容を変える
function connectionHint(label, url) {
  if (url !== DEFAULTS.shortUrl && url !== DEFAULTS.longUrl) return "サーバーが起動しているか、URL が正しいか確認してください。";
  if (label === "2B") {
    return "\n  → 2B を使うには、翻訳サーバーのセットの「自動起動を設定する」(Windows は .bat、Mac は .command)で「2. 0.8B と 2B」を選んでください(それまでは 0.8B で翻訳します)。選んだ直後は、ダウンロードが終わるまで数分かかります。";
  }
  return "\n  → 設定した直後は、モデルの準備に数分かかります。少し待ってからもう一度押してください。\n  → まだ失敗するときは、翻訳サーバーのセットの「自動起動を設定する」(Windows は .bat、Mac は .command)をもう一度開いてください。";
}

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
    if (res.status === 503) throw new Error("モデルを準備しています。少し待ってからもう一度押してください。");
    if (!res.ok) throw new Error(`サーバーエラー ${res.status}`);
    const out = ((await res.json()).choices?.[0]?.text || "").trim();
    const ms = Math.round(performance.now() - t0);
    if (!out || BROKEN.test(out)) {
      return [false, `翻訳結果が正しくありません: "${out.slice(0, 30)}"(GPU を使っている場合は -ngl 0 --device none を付けて起動してください)`];
    }
    return [true, `成功: "Hello, world!" → "${out}"(${ms} ms)`];
  } catch (e) {
    return [false, e instanceof TypeError ? NOT_CONNECTED : e.message];
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
  const lines = results.map(([good, msg], i) => {
    const label = list[i][0];
    if (!good && msg === NOT_CONNECTED) msg += connectionHint(label, list[i][1]);
    return `${label}: ${msg}`;
  });
  flash($("status"), lines.join("\n"), results.every(([good]) => good) ? "ok" : "ng");
});

// 準備の手順は、お使いの OS の分を最初に表示し、ボタンで切り替えられるようにする
function showOs(os) {
  for (const b of document.querySelectorAll("[data-os]")) b.setAttribute("aria-pressed", String(b.dataset.os === os));
  for (const l of document.querySelectorAll("[data-steps]")) l.hidden = l.dataset.steps !== os;
}
for (const b of document.querySelectorAll("[data-os]")) b.addEventListener("click", () => showOs(b.dataset.os));
showOs(/mac/i.test(navigator.userAgentData?.platform || navigator.platform) ? "mac" : "win");

for (const btn of document.querySelectorAll(".copy")) {
  btn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(btn.previousElementSibling.textContent);
    btn.textContent = "コピーしました";
    setTimeout(() => (btn.textContent = "コピー"), 1500);
  });
}
