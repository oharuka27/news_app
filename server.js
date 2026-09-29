import net from 'node:net';
import express from 'express';
import { fetchFeed } from './src/news.js';
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

app.get('/api/news/:themeId', async (req, res) => {
  const theme = findTheme(req.params.themeId);
  if (!theme) {
    res.status(404).json({ error: '不明なテーマです' });
    return;
  }

  let items;
  try {
    items = await fetchFeed(theme.url, {
      limit: ITEMS_PER_THEME,
      sortByDate: theme.sortByDate,
    });
  } catch (err) {
    console.error(`[${theme.id}]`, err);
    res.status(502).json({ error: 'ニュースの取得に失敗しました' });
    return;
  }

  if (req.query.translate === '1' && theme.translatable) {
    res.json({ theme: theme.id, ...(await withTranslatedTitles(items)) });
    return;
  }
  res.json({ theme: theme.id, items });
});

app.listen(PORT, () => {
  console.log(`News app: http://localhost:${PORT}`);
  console.log(`DeepL 翻訳: ${isTranslationEnabled() ? '有効' : '無効（DEEPL_API_KEY 未設定）'}`);
});
