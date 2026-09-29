import { fetchFeed, searchUrl } from './news.js';
import { THEMES, findTheme } from './themes.js';
import { isTranslationEnabled, translateToJapanese, TranslationError } from './translate.js';

// Cloudflare Worker の入口。
// public/ の静的ファイルは Workers の静的アセットとして配信され、該当ファイルがないパスだけがここに来る。

const ITEMS_PER_THEME = 10;
const MAX_QUERY_LENGTH = 100;
const SEARCH_LANGS = ['ja', 'en'];

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

// 翻訳に失敗してもニュース自体は表示できるよう、原文のまま返してエラー内容を添える
async function withTranslatedTitles(items, env) {
  try {
    const translated = await translateToJapanese(items.map((item) => item.title), {
      apiKey: env.DEEPL_API_KEY,
    });
    return {
      items: items.map((item, i) => ({ ...item, translatedTitle: translated[i] })),
    };
  } catch (err) {
    if (!(err instanceof TranslationError)) console.error(err);
    const message = err instanceof TranslationError ? err.message : 'DeepL での翻訳に失敗しました';
    return { items, translationError: message };
  }
}

async function newsResponse(env, { url, sortByDate, translate, extra }) {
  let feed;
  try {
    feed = await fetchFeed(url, { limit: ITEMS_PER_THEME, sortByDate });
  } catch (err) {
    console.error(url, err);
    return json({ error: 'ニュースの取得に失敗しました' }, 502);
  }

  const { items, fetchedAt, stale } = feed;
  const meta = { ...extra, fetchedAt, stale };
  if (translate) return json({ ...meta, ...(await withTranslatedTitles(items, env)) });
  return json({ ...meta, items });
}

function handleThemes(env) {
  return json({
    translationEnabled: isTranslationEnabled(env.DEEPL_API_KEY),
    themes: THEMES.map(({ id, label, lang, translatable = false }) => ({
      id, label, lang, translatable,
    })),
  });
}

function handleThemeNews(themeId, searchParams, env) {
  const theme = findTheme(themeId);
  if (!theme) return json({ error: '不明なテーマです' }, 404);
  return newsResponse(env, {
    url: theme.url,
    sortByDate: theme.sortByDate,
    translate: searchParams.get('translate') === '1' && theme.translatable,
    extra: { theme: theme.id },
  });
}

// カスタムタブ: ユーザーが入力したキーワードで Google News を検索する
function handleSearch(searchParams, env) {
  const q = (searchParams.get('q') ?? '').trim();
  const lang = SEARCH_LANGS.includes(searchParams.get('lang')) ? searchParams.get('lang') : 'ja';
  if (!q) return json({ error: 'キーワードを入力してください' }, 400);
  if (q.length > MAX_QUERY_LENGTH) {
    return json({ error: `キーワードは ${MAX_QUERY_LENGTH} 文字以内で入力してください` }, 400);
  }
  // 直近 1 週間に絞って新しい順に並べる（ニッチなキーワードでも件数を確保するため 1 日より広め）
  return newsResponse(env, {
    url: searchUrl(`${q} when:7d`, lang),
    sortByDate: true,
    translate: searchParams.get('translate') === '1' && lang === 'en',
    extra: { query: q, lang },
  });
}

export default {
  async fetch(request, env) {
    const { pathname, searchParams } = new URL(request.url);
    if (!pathname.startsWith('/api/')) return new Response('Not Found', { status: 404 });
    if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);

    if (pathname === '/api/themes') return handleThemes(env);
    if (pathname === '/api/search') return handleSearch(searchParams, env);
    const newsMatch = pathname.match(/^\/api\/news\/([^/]+)$/);
    if (newsMatch) return handleThemeNews(newsMatch[1], searchParams, env);
    return json({ error: 'Not Found' }, 404);
  },
};
