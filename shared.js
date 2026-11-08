// content.js / background.js / options.js で共通の判定

const DEFAULT_SOURCE_LANGS = ["en"]; // 初期設定で翻訳する言語

// 算用数字だけの選択(年号・金額・電話番号など)。桁区切りや日付の記号は数字の一部とみなす
function isNumbersOnly(text) {
  return /\p{Nd}/u.test(text) && /^[\p{Nd}\s.,:\/+\-−．,:/+-]+$/u.test(text);
}

// ひらがな・カタカナを含めば日本語とみなす。
// 「機械翻訳」のように漢字だけのときは中国語と区別できないので、ページが日本語なら日本語とみなす。
function looksJapanese(text, pageLang) {
  if (/[぀-ヿ]/.test(text)) return true;
  const hasHan = /\p{Script=Han}/u.test(text);
  const hasLatin = /\p{Script=Latin}/u.test(text);
  return hasHan && !hasLatin && /^ja\b/i.test(pageLang || "");
}

// 言語ごとの文字の種類。書いていない言語はラテン文字
const LANG_SCRIPTS = {
  ja: ["Hiragana", "Katakana", "Han"], "zh-hans": ["Han"], "zh-hant": ["Han"], ko: ["Hangul"],
  ru: ["Cyrillic"], be: ["Cyrillic"], bg: ["Cyrillic"], kk: ["Cyrillic"], sr: ["Cyrillic", "Latin"],
  ar: ["Arabic"], fa: ["Arabic"], ur: ["Arabic"], he: ["Hebrew"],
  hi: ["Devanagari"], mr: ["Devanagari"], ne: ["Devanagari"], bn: ["Bengali"], gu: ["Gujarati"], pa: ["Gurmukhi"],
  ta: ["Tamil"], te: ["Telugu"], ml: ["Malayalam"], si: ["Sinhala"],
  th: ["Thai"], km: ["Khmer"], my: ["Myanmar"], ka: ["Georgian"], hy: ["Armenian"]
};

// Chrome の言語判定のコードを、モデルの言語コードに直す
function toModelLang(code) {
  const c = code.toLowerCase();
  if (c === "zh" || c === "zh-cn" || c === "zh-hans") return "zh-hans";
  if (c === "zh-tw" || c === "zh-hant") return "zh-hant";
  return { iw: "he", fil: "tl", jw: "jv" }[c] || c.split("-")[0];
}

// Chrome が PC の中で判定した言語の一覧(可能性の高い順)。判定できないときは空
async function detectLangs(text) {
  let result = null;
  try { result = await chrome.i18n.detectLanguage(text); } catch (_) {}
  return result?.isReliable ? result.languages.map((l) => toModelLang(l.language)).filter((l) => l !== "und") : [];
}

// 選んだ文章が「翻訳する言語」に入っているか
function isSourceAllowed(text, found, sourceLangs, targetLang) {
  const langs = (sourceLangs ?? DEFAULT_SOURCE_LANGS).filter((l) => l !== targetLang);
  if (found.length) return found.some((l) => langs.includes(l));
  // 短い語句などで判定できないときは、文字の種類が合う言語が選ばれていれば翻訳する
  return langs.some((l) => (LANG_SCRIPTS[l] || ["Latin"]).some((s) => new RegExp(`\\p{Script=${s}}`, "u").test(text)));
}

// 翻訳先の言語を決める。翻訳しないときは target が "" で、reason にその理由が入る。
// s は targetLang / altLang / sourceLangs を持つ設定
async function decideTarget(text, s, pageLang) {
  if (isNumbersOnly(text)) return { target: "", reason: "numbers" };
  const found = await detectLangs(text);
  // 翻訳先が日本語で、選んだ文章も日本語なら altLang を使う
  if (s.targetLang === "ja" && (looksJapanese(text, pageLang) || found[0] === "ja")) {
    return { target: s.altLang || "", reason: "japanese" };
  }
  if (isSourceAllowed(text, found, s.sourceLangs, s.targetLang)) return { target: s.targetLang, reason: "" };
  return { target: "", reason: "language" };
}
