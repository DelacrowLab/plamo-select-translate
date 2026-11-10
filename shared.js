// content.js / background.js / options.js で共通の判定

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

// 算用数字だけの選択(年号・金額・電話番号など)。桁区切りや日付の記号は数字の一部とみなす
function isNumbersOnly(text) {
  return /\p{Nd}/u.test(text) && /^[\p{Nd}\s.,:\/+\-−．,:/+-]+$/u.test(text);
}

// 絵文字だけの選択(肌の色・国旗・数字のキーキャップ・結合された絵文字や、間の空白を含む)
// \p{RGI_Emoji} には正規表現の v フラグ(Chrome 112 以降)が要る。古い Chrome でもこのファイル全体が止まらないよう、実行時に作る
const EMOJI_ONLY = (() => {
  try { return new RegExp("^(?:\\p{RGI_Emoji}|\\s)+$", "v"); } catch (_) { return /^[\p{Extended_Pictographic}\p{Emoji_Component}\s]+$/u; }
})();
function isEmojiOnly(text) {
  return EMOJI_ONLY.test(text) && /[^\s\d#*]/.test(text);
}

// ひらがな・カタカナを含めば日本語とみなす。ただし、英文の中に日本語の語が少し混ざっているだけのときは除く
// (ラテン文字が日本語の文字の 3 倍を超えるとき。「APIキーをGitHubで発行」のような文は日本語のまま)。
// 「機械翻訳」のように漢字だけのときは中国語と区別できないので、ページが日本語なら日本語とみなす。
function looksJapanese(text, pageLang) {
  const count = (re) => (text.match(re) || []).length;
  const latin = count(/\p{Script=Latin}/gu);
  if (/[぀-ヿ]/.test(text)) return latin <= count(/[぀-ヿ\p{Script=Han}]/gu) * 3;
  return /\p{Script=Han}/u.test(text) && latin === 0 && /^ja\b/i.test(pageLang || "");
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

// 選んだ文章を翻訳するか。翻訳先以外は何でも翻訳し、skipLangs(設定画面でチェックを外した言語)だけ除く
function isSourceAllowed(text, found, skipLangs, targetLang) {
  const skip = new Set(skipLangs || []);
  if (found.length) return found[0] !== targetLang && !skip.has(found[0]);
  if (!skip.size) return true;
  // 短い語句などで判定できないときは、文字の種類で考える。
  // その文字を使う言語がすべて除外されているときだけ翻訳しない(対応表にない文字は翻訳する)
  const usesScript = (code) => (LANG_SCRIPTS[code] || ["Latin"]).some((s) => new RegExp(`\\p{Script=${s}}`, "u").test(text));
  const matched = LANGS.map(([code]) => code).filter(usesScript);
  return !matched.length || matched.some((code) => code !== targetLang && !skip.has(code));
}

// 翻訳先の言語を決める。翻訳しないときは target が "" で、reason にその理由が入る。
// s は targetLang / altLang / skipLangs を持つ設定
async function decideTarget(text, s, pageLang) {
  if (isNumbersOnly(text)) return { target: "", reason: "numbers" };
  if (isEmojiOnly(text)) return { target: "", reason: "emoji" };
  const found = await detectLangs(text);
  // 翻訳先が日本語で、選んだ文章も日本語なら altLang を使う
  if (s.targetLang === "ja" && (looksJapanese(text, pageLang) || found[0] === "ja")) {
    return { target: s.altLang || "", reason: "japanese" };
  }
  if (isSourceAllowed(text, found, s.skipLangs, s.targetLang)) return { target: s.targetLang, reason: "" };
  return { target: "", reason: "language" };
}
