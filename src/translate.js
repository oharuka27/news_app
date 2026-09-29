// DeepL API Free（月 50 万文字まで無料）で見出しを日本語に翻訳する。
// 無料枠を節約するため、翻訳結果は D1 に保存して全利用者で再利用する。
// 探す順番: インスタンス内のメモリ → D1 → DeepL

const MAX_TEXTS_PER_REQUEST = 50; // DeepL API の 1 リクエストあたりの上限
const MAX_D1_PARAMS = 50; // D1 の 1 クエリのバインド数上限（100）に余裕を持たせる
const MAX_MEMORY_ENTRIES = 5000;
const RETENTION_DAYS = 30; // これより古い翻訳は定期実行で削除する（同じ見出しが再び出ることはほぼないため）

// 同じインスタンスで繰り返し D1 を読まないための小さなキャッシュ
const memoryCache = new Map();
// 翻訳中の文（原文 → Promise）。同時に来た要求で同じ文を二重に翻訳しない
const pendingTranslations = new Map();

// Free プランのキーは末尾が ":fx" で、エンドポイントが Pro と異なる
function endpoint(key) {
  return key.endsWith(':fx')
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate';
}

export function isTranslationEnabled(apiKey) {
  return Boolean(apiKey?.trim());
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

function remember(source, translated) {
  memoryCache.delete(source);
  memoryCache.set(source, translated);
  // Map は挿入順を保つので、先頭が最も古いエントリ
  if (memoryCache.size > MAX_MEMORY_ENTRIES) memoryCache.delete(memoryCache.keys().next().value);
}

function chunks(list, size) {
  const result = [];
  for (let i = 0; i < list.length; i += size) result.push(list.slice(i, i + size));
  return result;
}

async function lookupSaved(db, texts) {
  const found = new Map();
  for (const chunk of chunks(texts, MAX_D1_PARAMS)) {
    const placeholders = chunk.map(() => '?').join(', ');
    const { results } = await db
      .prepare(`SELECT source_text, translated_text FROM translations WHERE source_text IN (${placeholders})`)
      .bind(...chunk)
      .all();
    for (const row of results) found.set(row.source_text, row.translated_text);
  }
  return found;
}

async function saveTranslations(db, pairs) {
  const now = Date.now();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO translations (source_text, translated_text, created_at) VALUES (?, ?, ?)',
  );
  await db.batch(pairs.map(([source, translated]) => insert.bind(source, translated, now)));
}

// texts（重複なし・未翻訳）を D1 から探し、なければ DeepL で翻訳して D1 に保存する
async function resolveTranslations(texts, key, db) {
  let saved;
  try {
    saved = await lookupSaved(db, texts);
  } catch (err) {
    // D1 が使えないまま DeepL を呼ぶと、毎回訳し直して無料枠を使い切るおそれがあるため翻訳をやめる
    console.error('D1 から翻訳を読み込めませんでした', err);
    throw new TranslationError('翻訳の保存先（D1）に接続できないため、翻訳を停止しています');
  }
  saved.forEach((translated, source) => remember(source, translated));

  const missing = texts.filter((text) => !saved.has(text));
  for (const chunk of chunks(missing, MAX_TEXTS_PER_REQUEST)) {
    const results = await requestTranslation(key, chunk);
    const pairs = chunk.map((text, i) => [text, results[i]]);
    pairs.forEach(([source, translated]) => remember(source, translated));
    try {
      await saveTranslations(db, pairs);
    } catch (err) {
      // 今回の翻訳は返せるので、記録だけして続ける
      console.error('D1 に翻訳を保存できませんでした', err);
    }
  }
}

// texts と同じ順番で翻訳結果を返す
export async function translateToJapanese(texts, { apiKey, db }) {
  const key = apiKey?.trim() ?? '';
  if (!key) throw new TranslationError('DEEPL_API_KEY が設定されていません');
  if (!db) throw new TranslationError('翻訳の保存先（D1）が設定されていません');

  // メモリにもなく、他の要求が翻訳中でもない文だけを自分で解決する
  const toResolve = [...new Set(texts.filter(
    (t) => t && !memoryCache.has(t) && !pendingTranslations.has(t),
  ))];
  if (toResolve.length) {
    const job = resolveTranslations(toResolve, key, db)
      .finally(() => toResolve.forEach((text) => pendingTranslations.delete(text)));
    toResolve.forEach((text) => pendingTranslations.set(text, job));
  }

  // 自分が解決する分も、他の要求が翻訳中の分も、まとめて完了を待つ
  await Promise.all(new Set(texts.map((t) => pendingTranslations.get(t)).filter(Boolean)));
  return texts.map((t) => memoryCache.get(t) ?? t);
}

// 定期実行（Cron Trigger）から呼ばれ、古い翻訳を削除して D1 の容量を抑える
export async function deleteOldTranslations(db) {
  const threshold = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const { meta } = await db.prepare('DELETE FROM translations WHERE created_at < ?').bind(threshold).run();
  return meta.changes;
}
