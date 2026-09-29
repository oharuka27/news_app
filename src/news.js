import Parser from 'rss-parser';

// Google News RSS は API キー不要・無料で利用できる
const GOOGLE_NEWS_BASE = 'https://news.google.com/rss';
const CACHE_TTL_MS = 10 * 60 * 1000; // 取得元への負荷を抑えるため 10 分キャッシュ

const parser = new Parser({
  timeout: 10000,
  customFields: { item: ['source'] },
});

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

function sourceNameOf(item) {
  const src = item.source;
  if (!src) return '';
  return typeof src === 'string' ? src : (src._ ?? '');
}

function byDateDesc(a, b) {
  return (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '');
}

export async function fetchFeed(url, { limit = 10, sortByDate = false } = {}) {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.items.slice(0, limit);
  }

  const feed = await parser.parseURL(url);
  const items = feed.items.map((item) => {
    const source = sourceNameOf(item);
    return {
      title: splitTitle(item.title ?? '', source),
      link: item.link,
      source,
      publishedAt: item.isoDate ?? null,
    };
  });
  if (sortByDate) items.sort(byDateDesc);

  cache.set(url, { at: Date.now(), items });
  return items.slice(0, limit);
}
