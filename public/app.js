const tabsEl = document.getElementById('tabs');
const listEl = document.getElementById('news-list');
const statusEl = document.getElementById('status');
const reloadEl = document.getElementById('reload');
const noticeEl = document.getElementById('notice');
const translateToggleEl = document.getElementById('translate-toggle');
const translateEl = document.getElementById('translate');
const customFormEl = document.getElementById('custom-form');
const customQueryEl = document.getElementById('custom-query');
const customLangEl = document.getElementById('custom-lang');

const TAB_STORAGE_KEY = 'news_app:lastTab';
const TRANSLATE_STORAGE_KEY = 'news_app:translate';
const CUSTOM_STORAGE_KEY = 'news_app:custom';

// ユーザーが入力したキーワードで検索するタブ（サーバーの固定テーマとは別に画面側で追加する）
const CUSTOM_THEME = { id: 'custom', label: 'カスタム', custom: true };

let themes = [];
let translationEnabled = false;
let currentThemeId = null;
let customSearch = { query: '', lang: 'ja' };
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

function showNotice(message) {
  noticeEl.textContent = message ?? '';
  noticeEl.hidden = !message;
}

function currentTheme() {
  return themes.find((t) => t.id === currentThemeId);
}

function isTranslatable(themeId) {
  if (themeId === CUSTOM_THEME.id) return customSearch.lang === 'en';
  return Boolean(themes.find((t) => t.id === themeId)?.translatable);
}

function shouldTranslate(themeId) {
  return isTranslatable(themeId) && translationEnabled && translateEl.checked;
}

// 取得先 URL と画面側キャッシュのキーを返す。カスタムでキーワード未入力なら null
function requestFor(themeId) {
  const translate = shouldTranslate(themeId);
  const params = new URLSearchParams();
  if (translate) params.set('translate', '1');

  if (themeId === CUSTOM_THEME.id) {
    if (!customSearch.query) return null;
    params.set('q', customSearch.query);
    params.set('lang', customSearch.lang);
    return { url: `/api/search?${params}`, cacheKey: `custom:${params}`, translate };
  }
  const query = params.size ? `?${params}` : '';
  return {
    url: `/api/news/${encodeURIComponent(themeId)}${query}`,
    cacheKey: `${themeId}:${translate}`,
    translate,
  };
}

function updateTranslateToggle() {
  translateToggleEl.hidden = !isTranslatable(currentThemeId);
  translateEl.disabled = !translationEnabled;
  translateToggleEl.title = translationEnabled
    ? ''
    : 'DEEPL_API_KEY を設定すると翻訳できます（README 参照）';
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
    a.textContent = item.translatedTitle ?? item.title;
    li.append(a);

    if (item.translatedTitle) {
      const original = document.createElement('div');
      original.className = 'news-original';
      original.lang = 'en';
      original.textContent = item.title;
      li.append(original);
    }

    const meta = document.createElement('div');
    meta.className = 'news-meta';
    meta.textContent = [item.source, formatDate(item.publishedAt)].filter(Boolean).join(' ・ ');
    li.append(meta);
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
  showNotice('');
  const request = requestFor(themeId);
  if (!request) {
    listEl.replaceChildren();
    showStatus('キーワードを入力して検索してください');
    return;
  }

  const { url, cacheKey, translate } = request;
  if (!force && newsCache.has(cacheKey)) {
    renderItems(newsCache.get(cacheKey));
    showStatus('');
    return;
  }

  listEl.replaceChildren();
  showStatus(translate ? '読み込み・翻訳中…' : '読み込み中…');
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    // 翻訳に失敗した結果はキャッシュせず、次回また翻訳を試みる
    if (!data.translationError) newsCache.set(cacheKey, data.items);
    // 読み込み中にタブや検索条件が変わっていたら描画しない
    if (cacheKey !== requestFor(currentThemeId)?.cacheKey) return;
    renderItems(data.items);
    showNotice(data.translationError);
    showStatus(data.items.length ? '' : 'ニュースが見つかりませんでした');
  } catch (err) {
    if (cacheKey !== requestFor(currentThemeId)?.cacheKey) return;
    showStatus(err.message || 'ニュースの取得に失敗しました');
  }
}

function selectTheme(themeId) {
  currentThemeId = themeId;
  try { localStorage.setItem(TAB_STORAGE_KEY, themeId); } catch {}
  renderTabs();
  customFormEl.hidden = themeId !== CUSTOM_THEME.id;
  updateTranslateToggle();
  loadNews(themeId);
}

customFormEl.addEventListener('submit', (event) => {
  event.preventDefault();
  customSearch = { query: customQueryEl.value.trim(), lang: customLangEl.value };
  try { localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(customSearch)); } catch {}
  updateTranslateToggle();
  loadNews(CUSTOM_THEME.id);
});

reloadEl.addEventListener('click', () => {
  if (currentThemeId) loadNews(currentThemeId, { force: true });
});

translateEl.addEventListener('change', () => {
  try { localStorage.setItem(TRANSLATE_STORAGE_KEY, String(translateEl.checked)); } catch {}
  if (currentThemeId) loadNews(currentThemeId);
});

async function init() {
  try {
    const res = await fetch('/api/themes');
    ({ themes, translationEnabled } = await res.json());
    themes.push(CUSTOM_THEME);
  } catch {
    showStatus('テーマの取得に失敗しました');
    return;
  }
  let saved = null;
  try {
    saved = localStorage.getItem(TAB_STORAGE_KEY);
    // 翻訳は既定でオン（キー未設定時は無効化される）
    translateEl.checked = localStorage.getItem(TRANSLATE_STORAGE_KEY) !== 'false';
    const savedCustom = JSON.parse(localStorage.getItem(CUSTOM_STORAGE_KEY) ?? 'null');
    if (savedCustom?.query) {
      customSearch = { query: String(savedCustom.query), lang: savedCustom.lang === 'en' ? 'en' : 'ja' };
    }
  } catch {
    translateEl.checked = true;
  }
  customQueryEl.value = customSearch.query;
  customLangEl.value = customSearch.lang;
  const initial = themes.some((t) => t.id === saved) ? saved : themes[0].id;
  selectTheme(initial);
}

init();
