// ツールバーのアイコンを押したときの小さな画面。今のサイトでの一時停止と、設定画面への入口
const $ = (id) => document.getElementById(id);

$("settings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

async function getPausedSites() {
  return (await chrome.storage.sync.get("pausedSites")).pausedSites || [];
}

function render(paused) {
  $("pause").textContent = paused ? "このサイトで再開する" : "このサイトで一時停止";
  $("pause").className = paused ? "" : "sub";
  $("state").textContent = paused
    ? "一時停止中: 文字を選んでも翻訳しません。右クリックとショートカットでは翻訳できます。"
    : "文字を選ぶと翻訳します。";
}

(async () => {
  // サイト名はタブの中のスクリプトに聞く(タブの URL を読む権限を増やさないため)
  let site = "";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    site = await chrome.tabs.sendMessage(tab.id, { type: "get-site" }, { frameId: 0 });
  } catch (_) {}
  if (!site) {
    $("state").textContent = "このページでは使えません(開いていたページは、再読み込みすると使えるようになります)。";
    return;
  }
  $("site").textContent = site;
  render((await getPausedSites()).includes(site));
  $("pause").hidden = false;
  $("pause").addEventListener("click", async () => {
    const sites = await getPausedSites();
    const paused = !sites.includes(site);
    try {
      await chrome.storage.sync.set({ pausedSites: paused ? [...sites, site] : sites.filter((s) => s !== site) });
      render(paused);
    } catch (_) {
      $("state").textContent = "保存できませんでした。";
    }
  });
})();
