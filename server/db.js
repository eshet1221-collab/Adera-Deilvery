const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");

const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DATABASE_PATH || path.join(dataDir, "loyal-delivery-movers.db");
// node:sqlite (built into Node 22.5+) — no native compilation, unlike
// better-sqlite3, which needs a matching prebuilt binary or a full C++/Python
// toolchain to build from source.
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

// CREATE TABLE IF NOT EXISTS only helps on a brand-new database file — it's a
// no-op against a table that already exists, so columns added after the
// first release (fayda_id, proof_*) need an explicit additive migration or
// they'd silently never appear on a database created by an earlier version
// of this schema.
function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = columns.some((c) => c.name === column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS couriers (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name       TEXT NOT NULL,
      phone           TEXT NOT NULL,
      fayda_id        TEXT NOT NULL DEFAULT '',
      password_hash   TEXT,
      tier_capability TEXT NOT NULL DEFAULT 'express,standard',
      status          TEXT NOT NULL DEFAULT 'active',
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      tracking_code       TEXT NOT NULL UNIQUE,
      otp_code            TEXT NOT NULL,
      tier                TEXT NOT NULL,
      item_description    TEXT,
      distance_km         REAL NOT NULL,
      price_birr          REAL NOT NULL,
      sender_name         TEXT NOT NULL,
      sender_phone        TEXT NOT NULL,
      recipient_name      TEXT NOT NULL,
      recipient_phone     TEXT NOT NULL,
      pickup_address      TEXT NOT NULL,
      dropoff_address     TEXT NOT NULL,
      status              TEXT NOT NULL DEFAULT 'pending',
      courier_id          INTEGER REFERENCES couriers(id),
      proof_file_path     TEXT,
      proof_submitted_at  TEXT,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token       TEXT PRIMARY KEY,
      courier_id  INTEGER NOT NULL REFERENCES couriers(id),
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS testimonials (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      author_name TEXT NOT NULL,
      role        TEXT NOT NULL,
      rating      INTEGER,
      comment     TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Courier wallet ledger. amount_birr is signed (+credit / -debit);
    -- balance_after_birr is a snapshot so history renders without
    -- recomputing a running sum. type: 'topup' | 'delivery_payout' |
    -- 'commission_debit'.
    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      courier_id         INTEGER NOT NULL REFERENCES couriers(id),
      order_id           INTEGER REFERENCES orders(id),
      type               TEXT NOT NULL,
      amount_birr        REAL NOT NULL,
      balance_after_birr REAL NOT NULL,
      reference          TEXT,
      created_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_tracking_code ON orders(tracking_code);
    CREATE INDEX IF NOT EXISTS idx_orders_tier ON orders(tier);
    CREATE INDEX IF NOT EXISTS idx_orders_courier_id ON orders(courier_id);
    CREATE INDEX IF NOT EXISTS idx_couriers_status ON couriers(status);
    CREATE INDEX IF NOT EXISTS idx_couriers_phone ON couriers(phone);
    CREATE INDEX IF NOT EXISTS idx_sessions_courier ON sessions(courier_id);
    CREATE INDEX IF NOT EXISTS idx_wallet_tx_courier ON wallet_transactions(courier_id);
    CREATE INDEX IF NOT EXISTS idx_wallet_tx_order ON wallet_transactions(order_id);
  `);

  // Additive migration for databases created before these columns existed.
  ensureColumn("couriers", "fayda_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("couriers", "password_hash", "TEXT");
  ensureColumn("couriers", "email", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("couriers", "gender", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("couriers", "photo_path", "TEXT");
  ensureColumn("couriers", "fayda_id_photo_path", "TEXT");
  ensureColumn("orders", "proof_file_path", "TEXT");
  ensureColumn("orders", "proof_submitted_at", "TEXT");
  ensureColumn("couriers", "wallet_balance_birr", "REAL NOT NULL DEFAULT 0");
  ensureColumn("orders", "payment_method", "TEXT NOT NULL DEFAULT 'prepaid'");
  ensureColumn("orders", "payment_status", "TEXT NOT NULL DEFAULT 'pending'");
  ensureColumn("orders", "payment_reference", "TEXT");
  ensureColumn("orders", "commission_birr", "REAL");
  ensureColumn("orders", "courier_payout_birr", "REAL");
  ensureColumn("orders", "cash_confirmed_at", "TEXT");

  // One-time, idempotent normalization for orders that predate the payment
  // engine: they were delivered under the old (unstored, computed-on-the-fly)
  // per-tier commission model, so this backfills them onto the new flat-18%
  // ledger fields for consistency with computeStatsByCourier()'s running
  // totals. Deliberately does NOT touch wallet_balance_birr or write
  // wallet_transactions rows — that ledger starts fresh from here forward.
  db.exec(`
    UPDATE orders
    SET payment_method = 'prepaid',
        payment_status = 'settled',
        commission_birr = ROUND(price_birr * 0.18, 2),
        courier_payout_birr = ROUND(price_birr * 0.82, 2)
    WHERE status = 'delivered' AND commission_birr IS NULL
  `);

  setupSearch();
}

// FTS5 full-text search — an inverted index, not a `LIKE '%term%'` table
// scan, so this stays fast at millions of rows (which a plain LIKE scan
// would not). "External content" tables (content='orders', content_rowid)
// keep the FTS index separate from the row data instead of duplicating it,
// synced via triggers on every insert/update/delete. tokenize='trigram'
// gives true substring matching (e.g. searching "364" finds a phone number
// with "364" in the middle of it) instead of the default tokenizer's
// match-from-start-of-word-only behavior — at the cost of a larger index,
// which is the right trade for an admin search box.
//
// CREATE VIRTUAL TABLE IF NOT EXISTS is a no-op against a table that
// already exists — including one created before tokenize='trigram' was
// added here — so dropNonTrigramFts() detects and recreates any such
// leftover table before the CREATE runs.
function dropNonTrigramFts(tableName) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
  if (row && row.sql && !row.sql.includes("trigram")) {
    db.exec(`DROP TABLE ${tableName}`);
  }
}

function setupSearch() {
  dropNonTrigramFts("orders_fts");
  dropNonTrigramFts("couriers_fts");

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS orders_fts USING fts5(
      tracking_code, sender_name, sender_phone, recipient_name, recipient_phone,
      pickup_address, dropoff_address,
      content='orders', content_rowid='id', tokenize='trigram'
    );

    CREATE TRIGGER IF NOT EXISTS orders_fts_ai AFTER INSERT ON orders BEGIN
      INSERT INTO orders_fts(rowid, tracking_code, sender_name, sender_phone, recipient_name, recipient_phone, pickup_address, dropoff_address)
      VALUES (new.id, new.tracking_code, new.sender_name, new.sender_phone, new.recipient_name, new.recipient_phone, new.pickup_address, new.dropoff_address);
    END;
    CREATE TRIGGER IF NOT EXISTS orders_fts_ad AFTER DELETE ON orders BEGIN
      INSERT INTO orders_fts(orders_fts, rowid, tracking_code, sender_name, sender_phone, recipient_name, recipient_phone, pickup_address, dropoff_address)
      VALUES ('delete', old.id, old.tracking_code, old.sender_name, old.sender_phone, old.recipient_name, old.recipient_phone, old.pickup_address, old.dropoff_address);
    END;
    CREATE TRIGGER IF NOT EXISTS orders_fts_au AFTER UPDATE ON orders BEGIN
      INSERT INTO orders_fts(orders_fts, rowid, tracking_code, sender_name, sender_phone, recipient_name, recipient_phone, pickup_address, dropoff_address)
      VALUES ('delete', old.id, old.tracking_code, old.sender_name, old.sender_phone, old.recipient_name, old.recipient_phone, old.pickup_address, old.dropoff_address);
      INSERT INTO orders_fts(rowid, tracking_code, sender_name, sender_phone, recipient_name, recipient_phone, pickup_address, dropoff_address)
      VALUES (new.id, new.tracking_code, new.sender_name, new.sender_phone, new.recipient_name, new.recipient_phone, new.pickup_address, new.dropoff_address);
    END;

    CREATE VIRTUAL TABLE IF NOT EXISTS couriers_fts USING fts5(
      full_name, phone, fayda_id,
      content='couriers', content_rowid='id', tokenize='trigram'
    );

    CREATE TRIGGER IF NOT EXISTS couriers_fts_ai AFTER INSERT ON couriers BEGIN
      INSERT INTO couriers_fts(rowid, full_name, phone, fayda_id) VALUES (new.id, new.full_name, new.phone, new.fayda_id);
    END;
    CREATE TRIGGER IF NOT EXISTS couriers_fts_ad AFTER DELETE ON couriers BEGIN
      INSERT INTO couriers_fts(couriers_fts, rowid, full_name, phone, fayda_id) VALUES ('delete', old.id, old.full_name, old.phone, old.fayda_id);
    END;
    CREATE TRIGGER IF NOT EXISTS couriers_fts_au AFTER UPDATE ON couriers BEGIN
      INSERT INTO couriers_fts(couriers_fts, rowid, full_name, phone, fayda_id) VALUES ('delete', old.id, old.full_name, old.phone, old.fayda_id);
      INSERT INTO couriers_fts(rowid, full_name, phone, fayda_id) VALUES (new.id, new.full_name, new.phone, new.fayda_id);
    END;
  `);

  // Triggers only cover rows written AFTER the FTS tables existed — back-fill
  // any rows already in the database from before this migration.
  //
  // NOTE: this does NOT guard on "is the index empty" — for an external-
  // content FTS5 table (content='orders'), an unfiltered `SELECT`/`COUNT(*)`
  // against orders_fts reads straight through to the orders table itself
  // and returns rows whether or not anything was ever inserted into the
  // actual search index. That makes an emptiness check useless (always
  // "non-empty" the moment the source table has rows) — confirmed by
  // testing it directly: MATCH found nothing despite COUNT(*) reporting
  // rows, until the index was populated for real. `INSERT OR IGNORE`
  // sidesteps this entirely — safe and idempotent to run on every startup,
  // since FTS5 enforces rowid uniqueness and silently skips rows already
  // in the index.
  db.exec(`
    INSERT OR IGNORE INTO orders_fts(rowid, tracking_code, sender_name, sender_phone, recipient_name, recipient_phone, pickup_address, dropoff_address)
    SELECT id, tracking_code, sender_name, sender_phone, recipient_name, recipient_phone, pickup_address, dropoff_address FROM orders;

    INSERT OR IGNORE INTO couriers_fts(rowid, full_name, phone, fayda_id)
    SELECT id, full_name, phone, fayda_id FROM couriers;
  `);
}

module.exports = { db, init, dbPath };
