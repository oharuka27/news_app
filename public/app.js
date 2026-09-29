const tabsEl = document.getElementById('tabs');
const listEl = document.getElementById('news-list');
const statusEl = document.getElementById('status');
const reloadEl = document.getElementById('reload');

const TAB_STORAGE_KEY = 'news_app:lastTab';

let themes = [];
let currentThemeId = null;
// タブを切り替えるたびに再取得しないよう、取得結果を画面側でも保持する
const newsCache = new Map();

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('ja-JP', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function showStatus(message) {
  statusEl.textContent = message;
  statusEl.hidden = !message;
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

function renderTabs() {
  tabsEl.replaceChildren(...themes.map((theme) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab';
    button.role = 'tab';
    button.textContent = theme.label;
    button.dataset.themeId = theme.id;
    button.setAttribute('aria-selected', String(theme.id === currentThemeId));
    button.addEventListener('click', () => selectTheme(theme.id));
    return button;
  }));
}

async function loadNews(themeId, { force = false } = {}) {
  if (!force && newsCache.has(themeId)) {
    renderItems(newsCache.get(themeId));
    showStatus('');
    return;
  }

  listEl.replaceChildren();
  showStatus('読み込み中…');
  try {
    const res = await fetch(`/api/news/${encodeURIComponent(themeId)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    newsCache.set(themeId, data.items);
    // 読み込み中に別タブへ切り替えられていたら描画しない
    if (themeId !== currentThemeId) return;
    renderItems(data.items);
    showStatus(data.items.length ? '' : 'ニュースが見つかりませんでした');
  } catch (err) {
    if (themeId !== currentThemeId) return;
    showStatus(err.message || 'ニュースの取得に失敗しました');
  }
}

function selectTheme(themeId) {
  currentThemeId = themeId;
  try { localStorage.setItem(TAB_STORAGE_KEY, themeId); } catch {}
  renderTabs();
  loadNews(themeId);
}

reloadEl.addEventListener('click', () => {
  if (currentThemeId) loadNews(currentThemeId, { force: true });
});

async function init() {
  try {
    const res = await fetch('/api/themes');
    themes = (await res.json()).themes;
  } catch {
    showStatus('テーマの取得に失敗しました');
    return;
  }
  let saved = null;
  try { saved = localStorage.getItem(TAB_STORAGE_KEY); } catch {}
  const initial = themes.some((t) => t.id === saved) ? saved : themes[0].id;
  selectTheme(initial);
}

init();
