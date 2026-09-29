import express from 'express';
import { fetchFeed } from './src/news.js';
import { THEMES, findTheme } from './src/themes.js';

const app = express();
const PORT = process.env.PORT || 3000;
const ITEMS_PER_THEME = 10;

app.use(express.static('public'));

app.get('/api/themes', (req, res) => {
  res.json({ themes: THEMES.map(({ id, label, lang }) => ({ id, label, lang })) });
});

app.get('/api/news/:themeId', async (req, res) => {
  const theme = findTheme(req.params.themeId);
  if (!theme) {
    res.status(404).json({ error: '不明なテーマです' });
    return;
  }
  try {
    const items = await fetchFeed(theme.url, {
      limit: ITEMS_PER_THEME,
      sortByDate: theme.sortByDate,
    });
    res.json({ theme: theme.id, items });
  } catch (err) {
    console.error(`[${theme.id}]`, err);
    res.status(502).json({ error: 'ニュースの取得に失敗しました' });
  }
});

app.listen(PORT, () => {
  console.log(`News app: http://localhost:${PORT}`);
});
