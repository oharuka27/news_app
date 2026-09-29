// DeepL API Free（月 50 万文字まで無料）で見出しを日本語に翻訳する。
// 無料枠を節約するため、一度翻訳した文はメモリにキャッシュして再利用する。

const MAX_TEXTS_PER_REQUEST = 50; // DeepL API の 1 リクエストあたりの上限
const MAX_CACHE_ENTRIES = 5000;
const translationCache = new Map();

function apiKey() {
  return process.env.DEEPL_API_KEY?.trim() || '';
}

// Free プランのキーは末尾が ":fx" で、エンドポイントが Pro と異なる
function endpoint(key) {
  return key.endsWith(':fx')
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate';
}

export function isTranslationEnabled() {
  return apiKey() !== '';
}

export class TranslationError extends Error {}

function errorMessageFor(status) {
  switch (status) {
    case 403: return 'DeepL API キーが正しくありません';
    case 456: return 'DeepL の今月の無料翻訳文字数を使い切りました';
    case 429: return 'DeepL へのリクエストが多すぎます。少し待ってから再試行してください';
    default: return `DeepL での翻訳に失敗しました (HTTP ${status})`;
  }
}

async function requestTranslation(key, texts) {
  const res = await fetch(endpoint(key), {
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: texts, target_lang: 'JA' }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new TranslationError(errorMessageFor(res.status));
  const data = await res.json();
  return data.translations.map((t) => t.text);
}

// 翻訳中の文（原文 → Promise）。同時に来た要求で同じ文を二重に翻訳しない
const pendingTranslations = new Map();

// texts と同じ順番で翻訳結果を返す
export async function translateToJapanese(texts) {
  const key = apiKey();
  if (!key) throw new TranslationError('DEEPL_API_KEY が設定されていません');

  // 翻訳済みでも翻訳中でもない文だけを DeepL に送る
  const toRequest = [...new Set(texts.filter(
    (t) => t && !translationCache.has(t) && !pendingTranslations.has(t),
  ))];
  for (let i = 0; i < toRequest.length; i += MAX_TEXTS_PER_REQUEST) {
    const chunk = toRequest.slice(i, i + MAX_TEXTS_PER_REQUEST);
    const request = requestTranslation(key, chunk)
      .then((results) => chunk.forEach((text, j) => translationCache.set(text, results[j])))
      .finally(() => chunk.forEach((text) => pendingTranslations.delete(text)));
    chunk.forEach((text) => pendingTranslations.set(text, request));
  }

  // 自分が送った分も、他の要求が翻訳中の分も、まとめて完了を待つ
  await Promise.all(new Set(texts.map((t) => pendingTranslations.get(t)).filter(Boolean)));

  const translated = texts.map((t) => translationCache.get(t) ?? t);
  // 古いものから捨てる（今回返す分は計算済みなので消えても問題ない）
  while (translationCache.size > MAX_CACHE_ENTRIES) {
    translationCache.delete(translationCache.keys().next().value);
  }
  return translated;
}
