// ページの中に翻訳を表示できないとき(Chrome の PDF ビューアーなど)に開く小さなウィンドウ
const out = document.getElementById("out");

function show(text, cls) {
  out.className = cls || "";
  out.textContent = text;
}

chrome.storage.session.get("resultText").then(async ({ resultText }) => {
  await chrome.storage.session.remove("resultText");
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
});
