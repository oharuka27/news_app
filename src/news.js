import { parseRssItems } from './rss.js';

// Google News RSS は API キー不要・無料で利用できる
const GOOGLE_NEWS_BASE = 'https://news.google.com/rss';
const CACHE_TTL_MS = 10 * 60 * 1000; // 取得元への負荷を抑えるため 10 分キャッシュ
const MAX_CACHE_ENTRIES = 200; // カスタム検索でキーワードごとに増え続けないよう上限を設ける

const FETCH_TIMEOUT_MS = 10000;

const cache = new Map();

const LOCALES = {
  ja: { hl: 'ja', gl: 'JP', ceid: 'JP:ja' },
  en: { hl: 'en-US', gl: 'US', ceid: 'US:en' },
};

function localeQuery(lang) {
  const { hl, gl, ceid } = LOCALES[lang] ?? LOCALES.ja;
  return new URLSearchParams({ hl, gl, ceid }).toString();
}

// トピック: WORLD / NATION / BUSINESS / TECHNOLOGY など
export function topicUrl(topic, lang = 'ja') {
  return `${GOOGLE_NEWS_BASE}/headlines/section/topic/${topic}?${localeQuery(lang)}`;
}

// キーワード検索（`when:1d` などの検索演算子も使える）
export function searchUrl(query, lang = 'ja') {
  const q = new URLSearchParams({ q: query }).toString();
  return `${GOOGLE_NEWS_BASE}/search?${q}&${localeQuery(lang)}`;
}

// Google News のタイトルは「見出し - 媒体名」形式なので媒体名を切り離す
function splitTitle(title, sourceName) {
  if (sourceName && title.endsWith(` - ${sourceName}`)) {
    return title.slice(0, -(sourceName.length + 3));
  }
  return title;
}

function toIsoDate(pubDate) {
  const date = new Date(pubDate);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function downloadFeed(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; news-app/1.0)' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Google News RSS の取得に失敗しました (HTTP ${res.status})`);
  return res.text();
}

function byDateDesc(a, b) {
  return (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '');
}

// 取得中のフィード（URL → Promise）。同時に来た要求で Google への取得を共有する
const pendingFetches = new Map();

async function fetchAndStore(url, sortByDate) {
  const items = parseRssItems(await downloadFeed(url)).map((item) => ({
    title: splitTitle(item.title, item.source),
    link: item.link,
    source: item.source,
    publishedAt: toIsoDate(item.pubDate),
  }));
  if (sortByDate) items.sort(byDateDesc);

  const entry = { at: Date.now(), items };
  cache.delete(url);
  cache.set(url, entry);
  // Map は挿入順を保つので、先頭が最も古いエントリ
  if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
  return entry;
}

function toResult(entry, limit, stale) {
  return { items: entry.items.slice(0, limit), fetchedAt: new Date(entry.at).toISOString(), stale };
}

// 取得結果は全利用者で共有する。
// - 10 分以内に取得済みならキャッシュを返す（誰が再読み込みしても同じ内容）
// - 同じフィードを取得中なら自分では取りに行かず、その結果を待つ
// - 取得に失敗しても期限切れのキャッシュがあればそれを返す（stale: true）
export async function fetchFeed(url, { limit = 10, sortByDate = false } = {}) {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return toResult(cached, limit, false);
  }

  let pending = pendingFetches.get(url);
  if (!pending) {
    pending = fetchAndStore(url, sortByDate).finally(() => pendingFetches.delete(url));
    pendingFetches.set(url, pending);
  }

  try {
    return toResult(await pending, limit, false);
  } catch (err) {
    const stale = cache.get(url);
    if (!stale) throw err;
    console.warn(`フィードの取得に失敗したため前回の内容を返します: ${url}`, err.message);
    return toResult(stale, limit, true);
  }
}
