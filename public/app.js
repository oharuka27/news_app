const tabsEl = document.getElementById('tabs');
const listEl = document.getElementById('news-list');
const statusEl = document.getElementById('status');
const reloadEl = document.getElementById('reload');
const fetchInfoEl = document.getElementById('fetch-info');
const noticeEl = document.getElementById('notice');
const translateToggleEl = document.getElementById('translate-toggle');
const translateEl = document.getElementById('translate');
const customFormEl = document.getElementById('custom-form');
const customQueryEl = document.getElementById('custom-query');
const customLangEl = document.getElementById('custom-lang');
const sectionDescEl = document.getElementById('section-desc');
const todayEl = document.getElementById('today');

const TAB_STORAGE_KEY = 'news_app:lastTab';
const TRANSLATE_STORAGE_KEY = 'news_app:translate';
const CUSTOM_STORAGE_KEY = 'news_app:custom';

// ユーザーが入力したキーワードで検索するタブ（サーバーの固定テーマとは別に画面側で追加する）
const CUSTOM_THEME = { id: 'custom', label: 'カスタム', custom: true };
// ☆ を付けた記事を一覧するタブ（ブラウザに保存した内容を表示するだけで通信しない）
const READ_LATER_THEME = { id: 'read-later', label: '後で読む' };

// 各タブの説明文
const SECTION_DESCRIPTIONS = {
  world: '海外主要メディアが伝える国際ニュース',
  domestic: '国内の主要ニュース',
  'ny-market': 'ウォール街・米国株の動き（直近 24 時間）',
  tse: '東証・日経平均・TOPIX の動き（直近 24 時間）',
  crypto: 'ビットコインなど暗号資産の動き（直近 24 時間）',
  tech: 'テクノロジーの話題',
  custom: '',
  'read-later': `☆ を付けた記事（このブラウザに最大 ${READ_LATER_MAX} 件）`,
};
const SKELETON_COUNT = 5;
// /api/translate の 1 件あたりの上限（サーバー側と同じ）
const MAX_TRANSLATE_TEXT_LENGTH = 300;

let themes = [];
let translationEnabled = false;
let currentThemeId = null;
let customSearch = { query: '', lang: 'ja' };
// タブを切り替えるたびに再取得しないよう、取得結果を画面側でも保持する
// （値は { items, fetchedAt, reloadableAt }）
const newsCache = new Map();
// 表示中のニュースの取得時刻と、再読み込みで新しい内容を取れるようになる時刻（端末の時計基準）
let currentFeed = null;
let reloadTimer = null;

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('ja-JP', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// 「3 時間前」のような相対表示（1 週間以上前は日時）
function formatRelative(iso) {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'たった今';
  if (minutes < 60) return `${minutes} 分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 時間前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 日前`;
  return formatDate(iso);
}

function showStatus(message) {
  statusEl.textContent = message;
  statusEl.hidden = !message;
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

// サーバーは 10 分間同じ内容を返すため、それまでは再読み込みボタンを押せなくし、いつから押せるかを表示する
function updateReloadState() {
  clearTimeout(reloadTimer);
  if (!currentFeed) {
    fetchInfoEl.hidden = true;
    return;
  }

  const waitMs = currentFeed.reloadableAt - Date.now();
  const fetched = `${formatTime(currentFeed.fetchedAt)} 取得`;
  fetchInfoEl.hidden = false;
  if (waitMs > 0) {
    reloadEl.disabled = true;
    fetchInfoEl.textContent = `${fetched} ・ ${formatTime(currentFeed.reloadableAt)} から再読み込みできます`;
    // 押せるようになる時刻に表示を切り替える
    reloadTimer = setTimeout(updateReloadState, waitMs + 500);
  } else {
    reloadEl.disabled = false;
    fetchInfoEl.textContent = `${fetched} ・ 再読み込みで最新のニュースを確認できます`;
  }
}

function setCurrentFeed(feed) {
  currentFeed = feed;
  reloadEl.disabled = false;
  updateReloadState();
}

function showNotice(message) {
  noticeEl.textContent = message ?? '';
  noticeEl.hidden = !message;
}

function currentTheme() {
  return themes.find((t) => t.id === currentThemeId);
}

// 保存時に言語を記録していない古い記事は、見出しに日本語の文字がなければ英語とみなす
function isEnglishItem(item) {
  if (item.lang) return item.lang === 'en';
  return !/[\u3040-\u30ff\u3400-\u9fff]/.test(item.title);
}

function isTranslatable(themeId) {
  if (themeId === CUSTOM_THEME.id) return customSearch.lang === 'en';
  if (themeId === READ_LATER_THEME.id) return readLater.load().some(isEnglishItem);
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

function langFor(themeId) {
  if (themeId === CUSTOM_THEME.id) return customSearch.lang;
  return themes.find((t) => t.id === themeId)?.lang ?? 'ja';
}

// 記事を登録したタブ名（「後で読む」タブでどこから登録したかを表示するため）
function themeLabelFor(themeId) {
  if (themeId === CUSTOM_THEME.id) return `カスタム「${customSearch.query}」`;
  return themes.find((t) => t.id === themeId)?.label ?? '';
}

function setStar(button, saved) {
  button.textContent = saved ? '★' : '☆';
  button.setAttribute('aria-pressed', String(saved));
  button.setAttribute('aria-label', saved ? '「後で読む」から外す' : '「後で読む」に追加');
  button.title = button.getAttribute('aria-label');
}

function confirmRemoveOldest(oldest) {
  const title = oldest.translatedTitle ?? oldest.title;
  return window.confirm(
    `「後で読む」は ${READ_LATER_MAX} 件までです。\n`
    + `一番古い「${title}」が消えますがよろしいですか？`,
  );
}

function onStarClick(item, { themeLabel, lang }, button) {
  // 押したことが分かるよう、☆ を小さく弾ませる
  button.classList.remove('is-popping');
  void button.offsetWidth; // アニメーションを再生し直すためにリフローさせる
  button.classList.add('is-popping');

  let result;
  try {
    result = readLater.toggle(item, { themeLabel, lang, confirmRemoveOldest });
  } catch {
    window.alert('「後で読む」を保存できませんでした。ブラウザの設定で保存が無効になっている可能性があります。');
    return;
  }
  if (result !== 'cancelled') onReadLaterChanged();
}

// 登録状態が変わったら、タブの件数と表示中の ☆/★ を更新する
function onReadLaterChanged() {
  renderTabs();
  if (currentThemeId === READ_LATER_THEME.id) {
    renderReadLater();
    return;
  }
  const links = readLater.links();
  for (const button of listEl.querySelectorAll('.star')) {
    setStar(button, links.has(button.dataset.link));
  }
}

function renderItems(items, { themeLabel = '', lang = 'ja', showThemeLabel = false } = {}) {
  const savedLinks = readLater.links();
  listEl.replaceChildren(...items.map((item, index) => {
    const li = document.createElement('li');
    li.className = 'news-item';
    li.style.setProperty('--i', index); // 上から順に浮かび上がらせる

    const body = document.createElement('div');
    body.className = 'news-body';

    const a = document.createElement('a');
    a.href = item.link;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'news-title';
    a.textContent = item.translatedTitle ?? item.title;
    body.append(a);

    if (item.translatedTitle) {
      const original = document.createElement('div');
      original.className = 'news-original';
      original.lang = 'en';
      original.textContent = item.title;
      body.append(original);
    }

    const meta = document.createElement('div');
    meta.className = 'news-meta';
    if (showThemeLabel && item.themeLabel) {
      const chip = document.createElement('span');
      chip.className = 'news-chip';
      chip.textContent = item.themeLabel;
      meta.append(chip);
    }
    if (item.source) {
      const source = document.createElement('span');
      source.className = 'news-source';
      source.textContent = item.source;
      meta.append(source);
    }
    if (item.publishedAt) {
      const time = document.createElement('time');
      time.className = 'news-time';
      time.dateTime = item.publishedAt;
      time.title = formatDate(item.publishedAt);
      time.textContent = formatRelative(item.publishedAt);
      meta.append(time);
    }
    body.append(meta);

    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'star';
    star.dataset.link = item.link;
    setStar(star, savedLinks.has(item.link));
    star.addEventListener('click', () => onStarClick(item, {
      themeLabel: item.themeLabel ?? themeLabel,
      lang: item.lang ?? lang,
    }, star));

    li.append(body, star);
    return li;
  }));
}

// 読み込み中は記事カードの形だけを表示する
function renderSkeleton() {
  listEl.replaceChildren(...Array.from({ length: SKELETON_COUNT }, () => {
    const li = document.createElement('li');
    li.className = 'news-item skeleton';
    li.setAttribute('aria-hidden', 'true');
    for (const modifier of ['', '', 'is-short']) {
      const line = document.createElement('div');
      line.className = `skeleton-line ${modifier}`.trim();
      li.append(line);
    }
    return li;
  }));
}

function renderSectionHead(themeId) {
  document.documentElement.dataset.section = themeId;
  sectionDescEl.textContent = SECTION_DESCRIPTIONS[themeId] ?? '';
}

function renderReadLater({ fetchMissing = true } = {}) {
  showNotice('');
  updateTranslateToggle();
  const list = readLater.load().reverse(); // 新しく登録した順に表示
  // 翻訳オフのときは保存済みの訳があっても原文だけを出す
  const showTranslation = translateEl.checked;
  renderItems(
    list.map((item) => (showTranslation ? item : { ...item, translatedTitle: undefined })),
    { showThemeLabel: true },
  );
  showStatus(list.length ? '' : 'まだありません。記事の ☆ をタップすると、ここに追加されます。');

  if (!fetchMissing || !shouldTranslate(READ_LATER_THEME.id)) return;
  const missing = [...new Set(list
    .filter((item) => isEnglishItem(item) && !item.translatedTitle)
    .map((item) => item.title)
    .filter((title) => title.length <= MAX_TRANSLATE_TEXT_LENGTH))];
  if (missing.length) translateSavedTitles(missing);
}

// 訳のない保存済み見出しをサーバーで翻訳し、ブラウザの保存内容に書き込んでから表示し直す
async function translateSavedTitles(texts) {
  showStatus('翻訳中…');
  let error = '';
  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    readLater.setTranslations(new Map(texts.map((text, i) => [text, data.translations[i]])));
  } catch (err) {
    error = err.message || '翻訳に失敗しました';
  }
  if (currentThemeId !== READ_LATER_THEME.id) return;
  renderReadLater({ fetchMissing: false });
  if (error) showNotice(error);
}

function renderTabs() {
  tabsEl.replaceChildren(...themes.map((theme) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab';
    button.role = 'tab';
    button.textContent = theme.label;
    if (theme.id === READ_LATER_THEME.id) {
      const count = readLater.load().length;
      if (count > 0) {
        const badge = document.createElement('span');
        badge.className = 'tab-badge';
        badge.textContent = String(count);
        badge.setAttribute('aria-label', `${count} 件`);
        button.append(badge);
      }
    }
    button.dataset.themeId = theme.id;
    button.setAttribute('aria-selected', String(theme.id === currentThemeId));
    button.addEventListener('click', () => selectTheme(theme.id));
    return button;
  }));
}

async function loadNews(themeId, { force = false } = {}) {
  if (themeId === READ_LATER_THEME.id) {
    setCurrentFeed(null); // 取得時刻の表示を消す
    renderReadLater();
    return;
  }

  showNotice('');
  const request = requestFor(themeId);
  if (!request) {
    setCurrentFeed(null);
      listEl.replaceChildren();
    showStatus('キーワードで Google News を検索（直近 1 週間）');
    return;
  }

  const { url, cacheKey, translate } = request;
  const renderOptions = { themeLabel: themeLabelFor(themeId), lang: langFor(themeId) };
  if (!force && newsCache.has(cacheKey)) {
    const cached = newsCache.get(cacheKey);
    renderItems(cached.items, renderOptions);
    setCurrentFeed(cached);
    showStatus('');
    return;
  }

  renderSkeleton();
  setCurrentFeed(null);
  reloadEl.disabled = true; // 読み込み中の連打を防ぐ
  showStatus(translate ? '読み込み・翻訳中…' : '読み込み中…');
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    // 翻訳や取得に失敗した場合は、すぐにやり直せるよう再読み込みを待たせない
    const failed = Boolean(data.translationError || data.stale);
    const feed = {
      items: data.items,
      fetchedAt: data.fetchedAt,
      reloadableAt: failed ? 0 : Date.now() + (data.refreshAfterSec ?? 0) * 1000,
    };
    // 失敗した結果はキャッシュせず、次回また取得を試みる
    if (!failed) newsCache.set(cacheKey, feed);
    // 読み込み中にタブや検索条件が変わっていたら描画しない
    if (cacheKey !== requestFor(currentThemeId)?.cacheKey) return;
    renderItems(data.items, renderOptions);
    setCurrentFeed(feed);
    showNotice([
      data.stale && `ニュースの取得に失敗したため、${formatDate(data.fetchedAt)} 時点の内容を表示しています`,
      data.translationError,
    ].filter(Boolean).join(' / '));
    showStatus(data.items.length ? '' : 'ニュースが見つかりませんでした');
  } catch (err) {
    if (cacheKey !== requestFor(currentThemeId)?.cacheKey) return;
    setCurrentFeed(null);
      listEl.replaceChildren();
    showStatus(err.message || 'ニュースの取得に失敗しました');
  }
}

function selectTheme(themeId) {
  currentThemeId = themeId;
  try { localStorage.setItem(TAB_STORAGE_KEY, themeId); } catch {}
  renderTabs();
  // スマホでタブが横に隠れていても、選んだタブが見えるようにする
  tabsEl.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  renderSectionHead(themeId);
  customFormEl.hidden = themeId !== CUSTOM_THEME.id;
  // カスタムは「検索」ボタンで取得し直し、後で読むは通信しないため、再読み込みボタンは出さない
  reloadEl.hidden = themeId === CUSTOM_THEME.id || themeId === READ_LATER_THEME.id;
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

// 同じページを別のブラウザタブで開いていて、そちらで登録/解除された場合も反映する
window.addEventListener('storage', (event) => {
  if (event.key === READ_LATER_STORAGE_KEY && themes.length) onReadLaterChanged();
});

translateEl.addEventListener('change', () => {
  try { localStorage.setItem(TRANSLATE_STORAGE_KEY, String(translateEl.checked)); } catch {}
  if (currentThemeId) loadNews(currentThemeId);
});

async function init() {
  const now = new Date();
  todayEl.dateTime = now.toISOString().slice(0, 10);
  todayEl.textContent = now.toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
  });

  try {
    const res = await fetch('/api/themes');
    ({ themes, translationEnabled } = await res.json());
    themes.push(CUSTOM_THEME, READ_LATER_THEME);
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
