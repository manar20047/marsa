/* SQLite-backed store (Node >= 22.5, built-in node:sqlite). Write-through: reads come from an in-memory
 * cache loaded at start-up; every insert/update/remove is persisted. Each entity table keeps the full record
 * as JSON plus generated, indexed columns for the relations used in queries and reports (see schema.sql). */
'use strict';
const fs = require('fs'), path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { MemoryStore } = require('../shared/service.js');

class SqliteStore extends MemoryStore {
  constructor(file) {
    super();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');
    this.db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    this.tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
    this.stmts = {};
    for (const t of this.tables) {
      this.stmts[t] = {
        up: this.db.prepare('INSERT INTO "' + t + '"(id, doc) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET doc = excluded.doc'),
        del: this.db.prepare('DELETE FROM "' + t + '" WHERE id = ?')
      };
      this.t[t] = this.db.prepare('SELECT doc FROM "' + t + '" ORDER BY rowid').all().map(r => JSON.parse(r.doc));
    }
    this.depth = 0;
  }
  ensure(t) { if (!this.stmts[t]) throw new Error('Unknown table ' + t + ' – add it to schema.sql'); return this.stmts[t]; }
  insert(t, row) { super.insert(t, row); this.ensure(t).up.run(String(row.id), JSON.stringify(row)); return row; }
  update(t, id, patch) { const r = super.update(t, id, patch); if (r) this.ensure(t).up.run(String(id), JSON.stringify(r)); return r; }
  remove(t, id) { super.remove(t, id); this.ensure(t).del.run(String(id)); }
  clear() { super.clear(); for (const t of this.tables) { this.t[t] = []; this.db.exec('DELETE FROM "' + t + '"'); } }
  tx(fn) { // nestable transaction wrapper
    if (this.depth++ === 0) this.db.exec('BEGIN');
    try { const r = fn(); if (--this.depth === 0) this.db.exec('COMMIT'); return r; }
    catch (e) { if (--this.depth === 0) this.db.exec('ROLLBACK'); throw e; }
  }
}
module.exports = { SqliteStore };
