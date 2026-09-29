import net from 'node:net';
import express from 'express';
import { fetchFeed, searchUrl } from './src/news.js';
import { THEMES, findTheme } from './src/themes.js';
import { isTranslationEnabled, translateToJapanese, TranslationError } from './src/translate.js';

// .env があれば読み込む（DEEPL_API_KEY など）
try {
  process.loadEnvFile();
} catch {}

// Node の IPv4/IPv6 自動切り替えは既定で 250ms 待つと次の候補へ移るが、
// DeepL など遠方のサーバーは接続に 250ms 以上かかることがあり失敗するため延ばす
net.setDefaultAutoSelectFamilyAttemptTimeout(2000);

const app = express();
const PORT = process.env.PORT || 3000;
const ITEMS_PER_THEME = 10;

app.use(express.static('public'));

app.get('/api/themes', (req, res) => {
  res.json({
    translationEnabled: isTranslationEnabled(),
    themes: THEMES.map(({ id, label, lang, translatable = false }) => ({
      id, label, lang, translatable,
    })),
  });
});

// 翻訳に失敗してもニュース自体は表示できるよう、原文のまま返してエラー内容を添える
async function withTranslatedTitles(items) {
  try {
    const translated = await translateToJapanese(items.map((item) => item.title));
    return {
      items: items.map((item, i) => ({ ...item, translatedTitle: translated[i] })),
    };
  } catch (err) {
    if (!(err instanceof TranslationError)) console.error(err);
    const message = err instanceof TranslationError ? err.message : 'DeepL での翻訳に失敗しました';
    return { items, translationError: message };
  }
}

async function sendNews(res, { url, sortByDate, translate, extra }) {
  let items;
  try {
    items = await fetchFeed(url, { limit: ITEMS_PER_THEME, sortByDate });
  } catch (err) {
    console.error(url, err);
    res.status(502).json({ error: 'ニュースの取得に失敗しました' });
    return;
  }

  if (translate) {
    res.json({ ...extra, ...(await withTranslatedTitles(items)) });
    return;
  }
  res.json({ ...extra, items });
}

app.get('/api/news/:themeId', async (req, res) => {
  const theme = findTheme(req.params.themeId);
  if (!theme) {
    res.status(404).json({ error: '不明なテーマです' });
    return;
  }
  await sendNews(res, {
    url: theme.url,
    sortByDate: theme.sortByDate,
    translate: req.query.translate === '1' && theme.translatable,
    extra: { theme: theme.id },
  });
});

const MAX_QUERY_LENGTH = 100;
const SEARCH_LANGS = ['ja', 'en'];

// カスタムタブ: ユーザーが入力したキーワードで Google News を検索する
app.get('/api/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const lang = SEARCH_LANGS.includes(req.query.lang) ? req.query.lang : 'ja';
  if (!q) {
    res.status(400).json({ error: 'キーワードを入力してください' });
    return;
  }
  if (q.length > MAX_QUERY_LENGTH) {
    res.status(400).json({ error: `キーワードは ${MAX_QUERY_LENGTH} 文字以内で入力してください` });
    return;
  }
  // 直近 1 週間に絞って新しい順に並べる（ニッチなキーワードでも件数を確保するため 1 日より広め）
  await sendNews(res, {
    url: searchUrl(`${q} when:7d`, lang),
    sortByDate: true,
    translate: req.query.translate === '1' && lang === 'en',
    extra: { query: q, lang },
  });
});

app.listen(PORT, () => {
  console.log(`News app: http://localhost:${PORT}`);
  console.log(`DeepL 翻訳: ${isTranslationEnabled() ? '有効' : '無効（DEEPL_API_KEY 未設定）'}`);
});
