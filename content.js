(() => {
  if (window.__plamoTranslateLoaded) return;
  window.__plamoTranslateLoaded = true;

  let host = null;
  let box = null;
  let closeBtn = null;
  let port = null;
  let lastText = "";
  const RELOAD_MSG = "拡張機能が更新されました。このページを再読み込みしてから、もう一度お試しください。";
  const PDF_HINT = "PDF では、文章を選んでから右クリック →「クイック翻訳で翻訳」を選んでください。";

  function ensureUI() {
    if (host) return;
    host = document.createElement("div");
    host.style.cssText = "all:initial;position:absolute;z-index:2147483647;top:0;left:0;";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `
      <style>
        .box{position:absolute;width:max-content;min-width:200px;max-width:min(640px,calc(100vw - 32px));
          box-sizing:border-box;padding:10px 14px;
          background:#fff;color:#1f2328;border:1px solid #1a73e8;border-radius:8px;
          box-shadow:0 6px 24px rgba(0,0,0,.2);font:14px/1.6 system-ui,"Yu Gothic",sans-serif;
          white-space:pre-wrap;word-break:break-word}
        .err{color:#cf222e}
        .hint{color:#59636e}
        .busy::after{content:"▍";animation:b 1s steps(2) infinite}
        @keyframes b{50%{opacity:0}}
        .close{position:fixed;top:20px;right:24px;border:0;background:none;font:18px/1 system-ui;cursor:pointer;color:#59636e}
        @media (prefers-color-scheme:dark){.box{background:#1f2328;color:#e6edf3;border-color:#4493f8}}
      </style>
      <div class="box" hidden></div>
      <button class="close" hidden aria-label="閉じる">×</button>`;
    box = root.querySelector(".box");
    closeBtn = root.querySelector(".close");
    closeBtn.addEventListener("click", hide);
    document.documentElement.appendChild(host);
  }

  // 拡張機能を更新・再読み込みすると、それ以前から開いていたタブのこのスクリプトは
  // 拡張機能とのつながりが切れ、chrome.* を呼ぶと「Extension context invalidated」エラーになる。
  // そのため、呼ぶ前につながっているかを確かめる。
  function alive() {
    try { return !!chrome.runtime?.id; } catch (_) { return false; }
  }

  function showMessage(msg) {
    ensureUI();
    box.className = "box err";
    box.textContent = msg;
    box.hidden = false;
  }

  // 拡張機能との通信路を閉じる(翻訳の途中なら中断される)
  function closePort() {
    if (port) { try { port.disconnect(); } catch (_) {} port = null; }
  }

  // PDF の上では選択位置が分からず、PDF をクリックしてもページに伝わらないので、右上に閉じるボタン付きで出す
  function placeForPdf() {
    box.style.cssText = "position:fixed;top:12px;right:16px;padding-right:40px";
    closeBtn.hidden = false;
  }

  function hide() {
    closePort();
    if (box) box.hidden = true;
    if (closeBtn) closeBtn.hidden = true;
  }

  // 選択中のテキストと、その位置を返す。入力欄(textarea / テキスト系の input)の中の選択にも対応する。
  // パスワード欄など、テキスト系以外の input は対象にしない。
  function getSelected() {
    const el = document.activeElement;
    // パスワード欄などテキスト以外の input にフォーカスがあるときは何もしない
    // (選択すると伏せ字「•••」がページの選択範囲として取れてしまうため)
    if (el && el.tagName === "INPUT" && !/^(text|search|url|email|tel)$/i.test(el.type || "text")) return null;
    const isTextInput = el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT");
    if (isTextInput) {
      try {
        const a = el.selectionStart, b = el.selectionEnd;
        if (a != null && b > a) {
          const text = el.value.slice(a, b).trim();
          if (text) return { text, rect: el.getBoundingClientRect() };
        }
      } catch (_) {}
    }
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : "";
    if (!text || sel.rangeCount === 0) return null;
    return { text, rect: sel.getRangeAt(0).getBoundingClientRect() };
  }

  // explicit: 右クリックメニューや Alt+T で翻訳を頼まれたとき true(文字を選んだだけの自動翻訳では false)
  // pdfText: PDF ビューアーの選択はページから読めないので、右クリックメニューから受け取った文章を使う
  function translate(explicit = false, pdfText = "") {
    const picked = pdfText ? { text: pdfText, rect: null } : getSelected();
    if (!picked) return;
    const { text, rect } = picked;
    lastText = text;

    ensureUI();
    hide();
    box.className = "box busy";
    box.textContent = "";
    box.hidden = false;

    if (!rect) {
      placeForPdf();
    } else {
    const top = rect.bottom + window.scrollY + 8;
    // パネルが右端で折り返されて細くならないよう、最大幅ぶんの余白を確保して配置する
    const vw = document.documentElement.clientWidth;
    const panelW = Math.min(640, vw - 32);
    const left = Math.max(window.scrollX + 16, Math.min(rect.left + window.scrollX, window.scrollX + vw - panelW - 16));
    box.style.top = top + "px";
    box.style.left = left + "px";
    }

    if (!alive()) return showMessage(RELOAD_MSG);
    try {
      port = chrome.runtime.connect({ name: "translate" });
    } catch (_) {
      return showMessage(RELOAD_MSG);
    }
    const myPort = port;
    // しばらく使っていなかったときは、サーバーがモデルを読み込み直すため数秒かかる。待っていることを知らせる
    let gotAny = false;
    let note = "";
    const hintTimer = setTimeout(() => {
      if (myPort === port && !gotAny) { box.className = "box busy hint"; box.textContent = "準備中…(しばらく使っていなかったときは数秒かかります)"; }
    }, 1500);
    myPort.onMessage.addListener((m) => {
      if (myPort !== port) return; // 新しい翻訳が始まっていたら、古い結果は無視
      if (!gotAny && (m.delta || m.error || m.done)) {
        gotAny = true;
        clearTimeout(hintTimer);
        if (box.classList.contains("hint")) { box.className = "box busy"; box.textContent = ""; }
      }
      if (m.skip) {
        // 日本語の文章を「翻訳しない」設定のとき。右クリックや Alt+T で頼まれた場合だけ理由を表示する
        clearTimeout(hintTimer);
        closePort();
        if (explicit) { box.className = "box hint"; box.textContent = m.message; }
        else box.hidden = true;
        return;
      }
      if (m.note) { note = m.note; return; } // 予備のモデルで翻訳したときの知らせ(訳文の後ろに表示)
      if (m.delta) box.textContent += m.delta;
      if (m.error) { box.className = "box err"; box.textContent = m.error; }
      if (m.done) {
        box.className = "box";
        if (note) box.textContent += "\n\n(" + note + ")";
      }
      // 翻訳が終わったら通信路はもう不要なので閉じる(開いたままだとページ移動時に警告が出る)
      if (m.done || m.error) closePort();
    });
    myPort.onDisconnect.addListener(() => {
      void chrome.runtime.lastError; // Chrome 側で閉じられた理由を確認済みにする(警告を出さない)
      if (myPort === port) {
        port = null;
        if (box && box.classList.contains("busy")) box.className = "box";
      }
    });
    myPort.postMessage({ text: text.slice(0, 5000), title: document.title, pageLang: document.documentElement.lang || "" });
  }

  document.addEventListener("mouseup", async (e) => {
    // ページのスクリプトが作った偽のマウス操作では翻訳しない(勝手に翻訳を繰り返させないため)
    if (!e.isTrusted) return;
    if (host && e.composedPath().includes(host)) return;
    // 選択確定後に判定
    setTimeout(async () => {
      const picked = getSelected();
      if (!picked) return hide();
      // 同じ文字のまま表示中なら、もう一度翻訳しない(選択範囲の中をクリックしたときなど)
      if (picked.text === lastText && box && !box.hidden) return;
      // 拡張機能の更新前から開いていたタブでは、何もしない(エラーを出さない)
      if (!alive()) return;
      let s;
      try {
        s = await chrome.storage.sync.get(["autoTranslate", "targetLang", "altLang", "skipLangs"]);
      } catch (_) {
        return;
      }
      if (s.autoTranslate === false) return;
      // 翻訳しない文章なら、パネルを出さずに何もしない
      const settings = { targetLang: s.targetLang || "ja", altLang: s.altLang ?? "", skipLangs: s.skipLangs };
      if (!(await decideTarget(picked.text, settings, document.documentElement.lang)).target) return;
      translate();
    }, 10);
  });

  document.addEventListener("mousedown", (e) => {
    if (host && e.composedPath().includes(host)) return;
    hide();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });

  // ページを離れるとき(「戻る」用の一時保存を含む)は、Chrome に閉じられる前に自分で閉じる
  window.addEventListener("pagehide", hide);

  // このページで受け持てたら true を返す(返さないと、右クリックのときは別ウィンドウで翻訳する)
  chrome.runtime.onMessage.addListener((m, _sender, respond) => {
    if (m.type !== "translate-selection") return;
    const isPdf = document.contentType === "application/pdf";
    // ショートカットはタブ全体に届くので、操作中のフレームだけが受け持つ(ほかのフレームに残った選択を訳さない)
    const active = m.selectionText || (document.hasFocus() && !/^I?FRAME$/.test(document.activeElement?.tagName || ""));
    // 右クリックのときは、今の選択が右クリックされた文章と同じ場合だけ受け持つ。
    // 違う場合(選択が消えた、別の枠に別の選択が残っているなど)は受け持たず、右クリックされた文章を別ウィンドウで翻訳する。
    // 改行や空白の扱いが Chrome と異なることがあるので、空白を除いた先頭 100 文字で比べる
    const key = (s) => s.replace(/\s+/g, "").slice(0, 100);
    const picked = getSelected();
    const sameText = !m.selectionText || (picked && key(picked.text) === key(m.selectionText));
    if (picked && active && sameText) {
      translate(true);
    } else if (isPdf && m.selectionText) {
      translate(true, m.selectionText);
    } else if (isPdf) {
      ensureUI();
      hide();
      box.className = "box hint";
      box.textContent = PDF_HINT;
      box.hidden = false;
      placeForPdf();
    } else {
      return;
    }
    respond(true);
  });
})();
