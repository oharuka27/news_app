// Google News RSS から必要な項目（見出し・リンク・日時・媒体名）だけを取り出す。
// 汎用の XML パーサーは記事要約（description）に含まれる大量の HTML まで解析して遅く、
// Workers 無料プランの CPU 時間（1 リクエスト 10ms）を圧迫するため、正規表現で必要な要素だけを読む。

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(text) {
  return text
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
      if (entity[0] !== '#') return ENTITIES[entity.toLowerCase()];
      const code = entity[1].toLowerCase() === 'x'
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10);
      return String.fromCodePoint(code);
    });
}

function readTag(xml, name) {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return match ? decode(match[1].trim()) : '';
}

export function parseRssItems(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => ({
    title: readTag(item, 'title'),
    link: readTag(item, 'link'),
    pubDate: readTag(item, 'pubDate'),
    source: readTag(item, 'source'),
  }));
}
