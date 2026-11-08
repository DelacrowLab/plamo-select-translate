// ページの中に翻訳を表示できないとき(Chrome の PDF ビューアーなど)に開く小さなウィンドウ
const out = document.getElementById("out");

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
    if (m.done && note) out.textContent += "\n\n(" + note + ")";
  });
  port.postMessage({ text: resultText, title: "", pageLang: "" });
}).catch(() => {
  // 拡張機能の更新直後などで、バックグラウンドとつながらないとき
  show("翻訳を開始できませんでした。chrome://extensions でこの拡張機能を再読み込みしてから、もう一度お試しください。", "err");
});
