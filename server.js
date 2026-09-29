import express from 'express';
import { fetchFeed, topHeadlinesUrl } from './src/news.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

app.get('/api/news', async (req, res) => {
  try {
    const items = await fetchFeed(topHeadlinesUrl('ja'), 10);
    res.json({ items });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'ニュースの取得に失敗しました' });
  }
});

app.listen(PORT, () => {
  console.log(`News app: http://localhost:${PORT}`);
});
