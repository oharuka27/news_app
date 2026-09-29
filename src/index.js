import { fetchFeed, searchUrl } from './news.js';
import { THEMES, findTheme } from './themes.js';
import {
  deleteOldTranslations, isTranslationEnabled, translateToJapanese, TranslationError,
} from './translate.js';

// Cloudflare Worker の入口。
// public/ の静的ファイルは Workers の静的アセットとして配信され、該当ファイルがないパスだけがここに来る。

const ITEMS_PER_THEME = 10;
const MAX_QUERY_LENGTH = 100;
const SEARCH_LANGS = ['ja', 'en'];

// /api/translate（「後で読む」に保存した見出しの翻訳）の上限。
// 任意の文章を送れる口になるため、DeepL の無料枠を使い込まれないよう見出し程度の量に制限する
const MAX_TRANSLATE_TEXTS = 20; // 「後で読む」の最大件数と同じ
const MAX_TRANSLATE_TEXT_LENGTH = 300;
const MAX_TRANSLATE_TOTAL_LENGTH = 3000;

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

// 翻訳に失敗してもニュース自体は表示できるよう、原文のまま返してエラー内容を添える
async function withTranslatedTitles(items, env) {
  try {
    const translated = await translateToJapanese(items.map((item) => item.title), {
      apiKey: env.DEEPL_API_KEY,
      db: env.DB,
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

async function newsResponse(env, origin, { url, sortByDate, translate, extra }) {
  let feed;
  try {
    feed = await fetchFeed(url, { origin, limit: ITEMS_PER_THEME, sortByDate });
  } catch (err) {
    console.error(url, err);
    return json({ error: 'ニュースの取得に失敗しました' }, 502);
  }

  const { items, fetchedAt, stale, refreshAfterSec } = feed;
  const meta = { ...extra, fetchedAt, stale, refreshAfterSec };
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

function handleThemeNews(themeId, searchParams, env, origin) {
  const theme = findTheme(themeId);
  if (!theme) return json({ error: '不明なテーマです' }, 404);
  return newsResponse(env, origin, {
    url: theme.url,
    sortByDate: theme.sortByDate,
    translate: searchParams.get('translate') === '1' && theme.translatable,
    extra: { theme: theme.id },
  });
}

// カスタムタブ: ユーザーが入力したキーワードで Google News を検索する
function handleSearch(searchParams, env, origin) {
  const q = (searchParams.get('q') ?? '').trim();
  const lang = SEARCH_LANGS.includes(searchParams.get('lang')) ? searchParams.get('lang') : 'ja';
  if (!q) return json({ error: 'キーワードを入力してください' }, 400);
  if (q.length > MAX_QUERY_LENGTH) {
    return json({ error: `キーワードは ${MAX_QUERY_LENGTH} 文字以内で入力してください` }, 400);
  }
  // 直近 1 週間に絞って新しい順に並べる（ニッチなキーワードでも件数を確保するため 1 日より広め）
  return newsResponse(env, origin, {
    url: searchUrl(`${q} when:7d`, lang),
    sortByDate: true,
    translate: searchParams.get('translate') === '1' && lang === 'en',
    extra: { query: q, lang },
  });
}

// 「後で読む」タブ用: 保存済みの見出しをまとめて翻訳する（翻訳結果は D1 に保存して再利用）
async function handleTranslate(request, env, origin) {
  // 他のサイトのページから呼ばれるのを防ぐ（ブラウザは POST に Origin ヘッダーを付ける）
  const requestOrigin = request.headers.get('Origin');
  if (requestOrigin && requestOrigin !== origin) return json({ error: 'Forbidden' }, 403);
  if (!isTranslationEnabled(env.DEEPL_API_KEY)) {
    return json({ error: 'DEEPL_API_KEY が設定されていません' }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'リクエストの形式が正しくありません' }, 400);
  }
  const texts = body?.texts;
  const valid = Array.isArray(texts)
    && texts.length > 0
    && texts.length <= MAX_TRANSLATE_TEXTS
    && texts.every((t) => typeof t === 'string' && t.trim() && t.length <= MAX_TRANSLATE_TEXT_LENGTH)
    && texts.reduce((sum, t) => sum + t.length, 0) <= MAX_TRANSLATE_TOTAL_LENGTH;
  if (!valid) {
    return json({
      error: `翻訳できるのは ${MAX_TRANSLATE_TEXTS} 件・1 件 ${MAX_TRANSLATE_TEXT_LENGTH} 文字までです`,
    }, 400);
  }

  try {
    const translations = await translateToJapanese(texts, { apiKey: env.DEEPL_API_KEY, db: env.DB });
    return json({ translations });
  } catch (err) {
    if (!(err instanceof TranslationError)) console.error(err);
    const message = err instanceof TranslationError ? err.message : 'DeepL での翻訳に失敗しました';
    return json({ error: message }, 502);
  }
}

export default {
  async fetch(request, env) {
    const { origin, pathname, searchParams } = new URL(request.url);
    if (!pathname.startsWith('/api/')) return new Response('Not Found', { status: 404 });
    if (pathname === '/api/translate') {
      if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
      return handleTranslate(request, env, origin);
    }
    if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);

    if (pathname === '/api/themes') return handleThemes(env);
    if (pathname === '/api/search') return handleSearch(searchParams, env, origin);
    const newsMatch = pathname.match(/^\/api\/news\/([^/]+)$/);
    if (newsMatch) return handleThemeNews(newsMatch[1], searchParams, env, origin);
    return json({ error: 'Not Found' }, 404);
  },

  // Cron Trigger（wrangler.jsonc の triggers.crons）で 1 日 1 回実行
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(deleteOldTranslations(env.DB).then((deleted) => {
      console.log(`古い翻訳を ${deleted} 件削除しました`);
    }));
  },
};
