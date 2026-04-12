import Database from 'better-sqlite3';

// On Railway, mount your volume at /data — that's where the file lives permanently.
// Locally it just creates lakehouse.db in your project folder.
const DB_PATH = process.env.DB_PATH || './lakehouse.db';

export const db = new Database(DB_PATH);

// WAL mode = much better performance when reads and writes happen at the same time.
// Without this, a write locks the whole file and your frontend GET would have to wait.
db.pragma('journal_mode = WAL');

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id                TEXT PRIMARY KEY,
    url               TEXT,
    source            TEXT DEFAULT 'telegram_link',
    raw_input         TEXT NOT NULL,
    content_type      TEXT,
    title             TEXT,
    summary           TEXT,
    author            TEXT,
    topics            TEXT DEFAULT '[]',   -- stored as JSON string, e.g. '["design","AI"]'
    tags              TEXT DEFAULT '[]',   -- user-editable, same format
    read_time_minutes INTEGER,
    urgency           TEXT DEFAULT 'someday',
    time_bound_until  TEXT,
    status            TEXT DEFAULT 'unread',
    is_inspiration    INTEGER DEFAULT 0,   -- SQLite has no bool; 0 = false, 1 = true
    rating            INTEGER,
    explore_with      TEXT,
    notes             TEXT,
    created_at        TEXT DEFAULT (datetime('now')),
    updated_at        TEXT DEFAULT (datetime('now'))
  )
`);

// ---------------------------------------------------------------------------
// Write — called by the webhook after Gemini enrichment
// ---------------------------------------------------------------------------
export function insertItem(item) {
  const stmt = db.prepare(`
    INSERT INTO items (
      id, url, source, raw_input, content_type, title, summary,
      author, topics, tags, read_time_minutes, urgency, notes
    ) VALUES (
      @id, @url, @source, @raw_input, @content_type, @title, @summary,
      @author, @topics, @tags, @read_time_minutes, @urgency, @notes
    )
  `);

  return stmt.run({
    ...item,
    topics: JSON.stringify(item.topics ?? []),
    tags:   JSON.stringify(item.tags   ?? []),
  });
}

// ---------------------------------------------------------------------------
// Read — called by GET /items, supports optional filters from query params
// ---------------------------------------------------------------------------
export function getItems({ status, urgency, content_type, topic } = {}) {
  let query  = 'SELECT * FROM items WHERE 1=1';
  const params = [];

  if (status)       { query += ' AND status = ?';        params.push(status); }
  if (urgency)      { query += ' AND urgency = ?';       params.push(urgency); }
  if (content_type) { query += ' AND content_type = ?';  params.push(content_type); }
  // Topic filter: check if the JSON array string contains this topic
  if (topic)        { query += ' AND topics LIKE ?';     params.push(`%"${topic}"%`); }

  query += ' ORDER BY created_at DESC';

  const rows = db.prepare(query).all(...params);

  // Parse JSON strings back into real arrays before sending to the frontend
  return rows.map(r => ({
    ...r,
    topics:         JSON.parse(r.topics || '[]'),
    tags:           JSON.parse(r.tags   || '[]'),
    is_inspiration: Boolean(r.is_inspiration),
  }));
}

// ---------------------------------------------------------------------------
// Patch — lets the frontend update status, urgency, tags, etc.
// Only fields in the allowlist can be changed — nothing else.
// ---------------------------------------------------------------------------
export function updateItem(id, fields) {
  const ALLOWED = [
    'status', 'urgency', 'tags', 'rating',
    'is_inspiration', 'explore_with', 'notes', 'time_bound_until'
  ];

  const toUpdate = Object.keys(fields).filter(k => ALLOWED.includes(k));
  if (toUpdate.length === 0) return;

  const setClauses = toUpdate.map(k => `${k} = @${k}`).join(', ');
  const stmt = db.prepare(
    `UPDATE items SET ${setClauses}, updated_at = datetime('now') WHERE id = @id`
  );

  return stmt.run({
    ...fields,
    id,
    tags: fields.tags ? JSON.stringify(fields.tags) : undefined,
  });
}