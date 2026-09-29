// 「後で読む」: ブラウザごとに localStorage へ保存する。
// 最大 READ_LATER_MAX 件で、超える場合は古いものから削除する。
const READ_LATER_STORAGE_KEY = 'news_app:readLater';
const READ_LATER_MAX = 20;

const readLater = {
  // 登録が古い順に並んだ配列を返す
  load() {
    try {
      const list = JSON.parse(localStorage.getItem(READ_LATER_STORAGE_KEY) ?? '[]');
      return Array.isArray(list) ? list.filter((item) => typeof item?.link === 'string') : [];
    } catch {
      return [];
    }
  },

  links() {
    return new Set(this.load().map((item) => item.link));
  },

  // 保存に失敗した場合（プライベートモードなど）は例外を投げる
  save(list) {
    localStorage.setItem(READ_LATER_STORAGE_KEY, JSON.stringify(list));
  },

  // 登録済みなら解除、未登録なら登録する。
  // 上限に達しているときは confirmRemoveOldest(最も古い項目) が true を返した場合だけ登録する。
  // 戻り値: 'added' | 'removed' | 'cancelled'
  toggle(item, { themeLabel, confirmRemoveOldest }) {
    const list = this.load();
    const index = list.findIndex((saved) => saved.link === item.link);
    if (index >= 0) {
      list.splice(index, 1);
      this.save(list);
      return 'removed';
    }

    if (list.length >= READ_LATER_MAX) {
      if (!confirmRemoveOldest(list[0])) return 'cancelled';
      list.splice(0, list.length - READ_LATER_MAX + 1);
    }
    list.push({
      link: item.link,
      title: item.title,
      translatedTitle: item.translatedTitle,
      source: item.source,
      publishedAt: item.publishedAt,
      themeLabel,
      savedAt: new Date().toISOString(),
    });
    this.save(list);
    return 'added';
  },
};
