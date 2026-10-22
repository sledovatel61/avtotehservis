-- 001_init.sql — начальная схема «АвтоТехСервис».
-- Миграция идемпотентна (IF NOT EXISTS). Откат словами: удалить таблицы в обратном порядке
-- (audit_log, slot_blocks, reviews, news, services, case_media, cases, outbox, lead_photos,
--  leads, media, sessions, admin_users, settings, schema_migrations) — на бою откат не нужен:
--  схема только добавляет таблицы.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,              -- JSON
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  login         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,           -- scrypt$N$r$p$salt$hash
  role          TEXT NOT NULL DEFAULT 'owner',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,       -- sha256 от токена; сам токен — только в httpOnly-cookie
  user_id    INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  user_agent TEXT,
  ip_hash    TEXT
);

CREATE TABLE IF NOT EXISTS media (
  id          TEXT PRIMARY KEY,          -- med_… / upl_…
  kind        TEXT NOT NULL CHECK (kind IN ('photo','video')),
  path        TEXT NOT NULL,             -- относительный путь внутри MEDIA_DIR (без пользовательских имён)
  poster_path TEXT,
  width       INTEGER,
  height      INTEGER,
  duration    INTEGER,                   -- секунды, для видео
  bytes       INTEGER,
  mime        TEXT NOT NULL,
  alt         TEXT,
  attached_to TEXT,                      -- 'lead:<id>' | 'case:<id>' | 'news:<id>' | NULL
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leads (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket          TEXT NOT NULL UNIQUE,  -- A-DDMM-XXXX (запись) / K-DDMM-XXXX (обращение с контактов)
  kind            TEXT NOT NULL DEFAULT 'booking' CHECK (kind IN ('booking','message')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  name            TEXT NOT NULL,
  phone           TEXT NOT NULL,         -- нормализованный +7XXXXXXXXXX
  contact_method  TEXT NOT NULL DEFAULT 'call' CHECK (contact_method IN ('call','telegram')),
  brand           TEXT,
  model           TEXT,
  year            INTEGER,
  vin             TEXT,
  mileage         INTEGER,
  services_json   TEXT NOT NULL DEFAULT '[]',
  preferred_date  TEXT,                  -- YYYY-MM-DD
  preferred_slot  TEXT,                  -- HH:MM
  asap            INTEGER NOT NULL DEFAULT 0,
  message         TEXT,                  -- для короткой формы контактов
  consent_at      TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  page            TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','confirmed','done','canceled')),
  ip_hash         TEXT,
  user_agent      TEXT,
  payload_json    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lead_photos (
  lead_id  INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  media_id TEXT    NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  PRIMARY KEY (lead_id, media_id)
);

CREATE TABLE IF NOT EXISTS outbox (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id         INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL CHECK (channel IN ('telegram','email')),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error      TEXT,
  sent_at         TEXT,
  UNIQUE (lead_id, channel)
);

CREATE TABLE IF NOT EXISTS cases (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  slug           TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL,
  description    TEXT,
  service_slug   TEXT,
  cover_media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
  cover_static   TEXT,                   -- встроенная SVG-заглушка из /img (только для сид-плейсхолдеров)
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  published_at   TEXT,
  sort           INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS case_media (
  case_id  INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  media_id TEXT    NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  sort     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (case_id, media_id)
);

CREATE TABLE IF NOT EXISTS services (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  short           TEXT,
  description     TEXT,                  -- Markdown (без сырого HTML)
  icon            TEXT,                  -- имя SVG из /img
  grp             TEXT,                  -- группа для чипов формы: Колёса / Ремонт и ТО / Электрика и комфорт
  tag             TEXT,                  -- метка карточки в каталоге (как в мокапе: Колёса / Ремонт и ТО / Диагностика)
  sort            INTEGER NOT NULL DEFAULT 0,
  hidden          INTEGER NOT NULL DEFAULT 0,  -- 1 = только чип формы, без публичной страницы
  chip            INTEGER NOT NULL DEFAULT 1,  -- 0 = не показывать в чипах формы (например, remont-shin)
  seo_title       TEXT,
  seo_description TEXT
);

CREATE TABLE IF NOT EXISTS news (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  slug           TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL,
  excerpt        TEXT,
  body_md        TEXT NOT NULL DEFAULT '',
  category       TEXT NOT NULL DEFAULT 'sovety' CHECK (category IN ('sezonnoe','sovety','servis')),
  cover_media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
  cover_static   TEXT,
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  published_at   TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reviews (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  author       TEXT NOT NULL,
  text         TEXT NOT NULL,
  rating       INTEGER CHECK (rating BETWEEN 1 AND 5),
  source       TEXT,                     -- Яндекс / 2ГИС / Zoon / сайт
  source_url   TEXT,
  published_at TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','hidden'))
);

CREATE TABLE IF NOT EXISTS slot_blocks (
  date   TEXT NOT NULL,                  -- YYYY-MM-DD
  slot   TEXT NOT NULL,                  -- HH:MM
  reason TEXT,
  PRIMARY KEY (date, slot)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER,
  action    TEXT NOT NULL,
  entity    TEXT,
  entity_id TEXT,
  at        TEXT NOT NULL DEFAULT (datetime('now')),
  meta_json TEXT                         -- без паролей и токенов
);

CREATE INDEX IF NOT EXISTS idx_leads_status   ON leads(status, created_at);
CREATE INDEX IF NOT EXISTS idx_leads_slot     ON leads(preferred_date, preferred_slot);
CREATE INDEX IF NOT EXISTS idx_outbox_due     ON outbox(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_news_pub       ON news(status, published_at);
CREATE INDEX IF NOT EXISTS idx_cases_pub      ON cases(status, sort);
CREATE INDEX IF NOT EXISTS idx_sessions_exp   ON sessions(expires_at);
