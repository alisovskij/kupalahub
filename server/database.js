import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export function openDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,email TEXT UNIQUE,password TEXT,name TEXT NOT NULL DEFAULT 'Студент',settings TEXT NOT NULL DEFAULT '{}');
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),scope TEXT NOT NULL,title TEXT NOT NULL,subject TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',due_date TEXT NOT NULL DEFAULT '',plan_date TEXT NOT NULL DEFAULT '',priority TEXT NOT NULL DEFAULT 'normal',done INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS tasks_owner ON tasks(user_id,scope);
    CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY,data TEXT NOT NULL,fetched_at TEXT NOT NULL);
  `);
  return db;
}
export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
