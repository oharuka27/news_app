// DeepL API Free（月 50 万文字まで無料）で見出しを日本語に翻訳する。
// 無料枠を節約するため、一度翻訳した文はメモリにキャッシュして再利用する。

const MAX_TEXTS_PER_REQUEST = 50; // DeepL API の 1 リクエストあたりの上限
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

// texts と同じ順番で翻訳結果を返す
export async function translateToJapanese(texts) {
  const key = apiKey();
  if (!key) throw new TranslationError('DEEPL_API_KEY が設定されていません');

  const untranslated = [...new Set(texts.filter((t) => t && !translationCache.has(t)))];
  for (let i = 0; i < untranslated.length; i += MAX_TEXTS_PER_REQUEST) {
    const chunk = untranslated.slice(i, i + MAX_TEXTS_PER_REQUEST);
    const results = await requestTranslation(key, chunk);
    chunk.forEach((text, j) => translationCache.set(text, results[j]));
  }
  return texts.map((t) => translationCache.get(t) ?? t);
}
