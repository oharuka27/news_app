import { searchUrl, topicUrl } from './news.js';

// 固定テーマの定義。
// - 世界 / NY市場 / 仮想通貨 は英語圏の一次情報を拾うため英語フィードを使う
// - 検索フィードは関連度順で古い記事が混ざるため、新しい順に並べ替える
export const THEMES = [
  {
    id: 'world',
    label: '世界',
    url: topicUrl('WORLD', 'en'),
    lang: 'en',
  },
  {
    id: 'domestic',
    label: '国内',
    url: topicUrl('NATION', 'ja'),
    lang: 'ja',
  },
  {
    id: 'ny-market',
    label: 'NY市場',
    url: searchUrl('"Wall Street" OR "Dow Jones" OR Nasdaq OR "S&P 500" when:1d', 'en'),
    lang: 'en',
    sortByDate: true,
  },
  {
    id: 'tse',
    label: '東証',
    url: searchUrl('東証 OR 日経平均 OR TOPIX when:1d', 'ja'),
    lang: 'ja',
    sortByDate: true,
  },
  {
    id: 'crypto',
    label: '仮想通貨',
    url: searchUrl('bitcoin OR ethereum OR cryptocurrency when:1d', 'en'),
    lang: 'en',
    sortByDate: true,
  },
  {
    id: 'tech',
    label: 'テック',
    url: topicUrl('TECHNOLOGY', 'ja'),
    lang: 'ja',
  },
];

export function findTheme(id) {
  return THEMES.find((theme) => theme.id === id);
}
