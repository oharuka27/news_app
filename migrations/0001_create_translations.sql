-- DeepL で翻訳した見出しを保存し、全利用者・全データセンターで再利用する（DeepL の無料枠を節約するため）
CREATE TABLE IF NOT EXISTS translations (
  source_text TEXT PRIMARY KEY,     -- 原文（英語の見出し）
  translated_text TEXT NOT NULL,    -- 日本語訳
  created_at INTEGER NOT NULL       -- 保存日時（UNIX ミリ秒）。古い行の定期削除に使う
);

CREATE INDEX IF NOT EXISTS idx_translations_created_at ON translations (created_at);
