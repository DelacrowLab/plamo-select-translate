// ページの中に翻訳を表示できないとき(Chrome の PDF ビューアーなど)に開く小さなウィンドウ
const out = document.getElementById("out");
const copy = document.getElementById("copy");
let translation = ""; // コピーする訳文(注記は含めない)
let copyTimer = 0;
let showCopy = false; // 設定でオンにしたときだけボタンを出す
chrome.storage.sync.get("showCopyButton").then((v) => {
  showCopy = v.showCopyButton === true;
  if (translation) copy.hidden = !showCopy; // 設定の読み込みが翻訳の完了より遅れたとき
}).catch(() => {});

copy.addEventListener("click", async () => {
  let ok = true;
  try { await navigator.clipboard.writeText(translation); } catch (_) { ok = false; }
  copy.textContent = ok ? "コピーしました" : "コピーできませんでした";
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => { copy.textContent = "コピー"; }, 1500);
});

function show(text, cls) {
  out.className = cls || "";
  out.textContent = text;
}

const id = new URLSearchParams(location.search).get("id");
chrome.runtime.sendMessage({ type: "take-result", id }).then((resultText) => {
  if (!resultText) return show("翻訳する文章がありません。", "hint");
  const port = chrome.runtime.connect({ name: "translate" });
  let started = false;
  let note = "";
  port.onMessage.addListener((m) => {
    if (m.skip) return show(m.message, "hint");
    if (m.note) { note = m.note; return; }
    if (m.delta) {
      if (!started) { started = true; show(""); }
      out.textContent += m.delta;
    }
    if (m.error) show(m.error, "err");
    if (m.done) {
      translation = out.textContent;
      copy.hidden = !translation || !showCopy;
      if (note) out.textContent += "\n\n(" + note + ")";
    }
  });
  port.postMessage({ text: resultText, title: "", pageLang: "" });
}).catch(() => {
  // 拡張機能の更新直後などで、バックグラウンドとつながらないとき
  show("翻訳を開始できませんでした。chrome://extensions でこの拡張機能を再読み込みしてから、もう一度お試しください。", "err");
});
