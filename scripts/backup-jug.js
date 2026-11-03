// Лёгкий ежедневный бэкап кэша AODP (data/jug.db) — не источник правды, восстановим кэш и без него,
// но VACUUM INTO даёт быстрое (секунда-две) восстановление после сбоя без прогрева краулером с нуля.
// Снимок консистентен даже при открытой на запись базе (readOnly-соединение, WAL не мешает).
'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT, 'data', 'jug.db');
const BACKUP_DIR = path.join(ROOT, 'export', 'backups', 'jug');
const KEEP_DAYS = 7;

function log(msg) {
  const line = `${new Date().toISOString()} ${msg}\n`;
  fs.appendFileSync(path.join(ROOT, 'logs', 'jug-backup.log'), line);
}

function main() {
  if (!fs.existsSync(DB_PATH)) { log('нет data/jug.db, пропуск'); return; }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const rawPath = path.join(BACKUP_DIR, `jug-${stamp}.db`);
  const gzPath = `${rawPath}.gz`;
  if (fs.existsSync(gzPath)) { log(`${stamp}: уже есть, пропуск`); return; }

  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  db.exec(`VACUUM INTO '${rawPath.replace(/'/g, "''")}'`);
  db.close();

  const raw = fs.readFileSync(rawPath);
  fs.writeFileSync(gzPath, zlib.gzipSync(raw, { level: 6 }));
  fs.unlinkSync(rawPath);
  log(`${stamp}: ок, ${(fs.statSync(gzPath).size / 1e6).toFixed(1)} МБ`);

  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  for (const name of fs.readdirSync(BACKUP_DIR)) {
    const m = /^jug-(\d{4}-\d{2}-\d{2})\.db\.gz$/.exec(name);
    if (!m) continue;
    if (new Date(`${m[1]}T00:00:00Z`).getTime() < cutoff) {
      fs.unlinkSync(path.join(BACKUP_DIR, name));
      log(`удалён старый снимок ${name}`);
    }
  }
}

main();
