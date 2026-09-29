const listEl = document.getElementById('news-list');
const statusEl = document.getElementById('status');

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('ja-JP', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function renderItems(items) {
  listEl.replaceChildren(...items.map((item) => {
    const li = document.createElement('li');
    li.className = 'news-item';

    const a = document.createElement('a');
    a.href = item.link;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'news-title';
    a.textContent = item.title;

    const meta = document.createElement('div');
    meta.className = 'news-meta';
    meta.textContent = [item.source, formatDate(item.publishedAt)].filter(Boolean).join(' ・ ');

    li.append(a, meta);
    return li;
  }));
}

async function load() {
  statusEl.textContent = '読み込み中…';
  statusEl.hidden = false;
  try {
    const res = await fetch('/api/news');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    renderItems(data.items);
    statusEl.hidden = data.items.length > 0;
    if (data.items.length === 0) statusEl.textContent = 'ニュースが見つかりませんでした';
  } catch (err) {
    statusEl.textContent = err.message || 'ニュースの取得に失敗しました';
  }
}

load();
