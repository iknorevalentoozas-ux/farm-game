/**
 * SQLite — เก็บเฉพาะของที่ต้องอยู่ข้ามรอบ: ชื่อผู้เล่น, คะแนนสูงสุดต่อแผนที่ (`farm_kv` key `best:<mapId>`),
 * และ asset ที่แอดมินอัปโหลด สถานะในรอบ (แปลง/ตะกร้า/เงิน/ออเดอร์) อยู่ในหน่วยความจำของ game.js ทั้งหมด
 *
 * ฐานข้อมูลเก่าจาก phase 1–3 อาจมีตาราง `plots` และคอลัมน์ players.x/y/carrots/coins/bag ค้างอยู่
 * ไม่มีโค้ดไหนอ่านแล้ว ปล่อยไว้ได้ (SQLite ลบคอลัมน์ยุ่งยาก)
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// FARM_DATA_DIR ให้รัน server ทดสอบแยกฐานข้อมูลได้ โดยไม่แตะ data/farm.db ที่ใช้เล่นจริง
const DATA_DIR = process.env.FARM_DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'farm.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    uuid TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    x REAL NOT NULL DEFAULT 400,
    y REAL NOT NULL DEFAULT 300,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  )
`);
db.exec(`CREATE TABLE IF NOT EXISTS farm_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
db.exec(`CREATE TABLE IF NOT EXISTS assets (key TEXT PRIMARY KEY, filename TEXT NOT NULL, updated_at INTEGER NOT NULL)`);

function getPlayer(uuid) {
  return db.prepare('SELECT * FROM players WHERE uuid = ?').get(uuid);
}

/** สร้างใหม่ถ้ายังไม่เคยมี, อัปเดตชื่อ/เวลาล่าสุดถ้ามีแล้ว — คืนแถวล่าสุดเสมอ */
function upsertPlayer({ uuid, name }) {
  const now = Date.now();
  const existing = getPlayer(uuid);
  if (existing) {
    db.prepare('UPDATE players SET name = ?, last_seen = ? WHERE uuid = ?').run(name || existing.name, now, uuid);
  } else {
    db.prepare('INSERT INTO players (uuid, name, created_at, last_seen) VALUES (?, ?, ?, ?)').run(
      uuid,
      name || 'ผู้เล่น',
      now,
      now,
    );
  }
  return getPlayer(uuid);
}

function kvGet(key, fallback) {
  const row = db.prepare('SELECT value FROM farm_kv WHERE key = ?').get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

function kvSet(key, value) {
  db.prepare('INSERT INTO farm_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    JSON.stringify(value),
  );
}

function getAssets() {
  return db.prepare('SELECT * FROM assets').all();
}

function setAsset(key, filename) {
  db.prepare(
    `INSERT INTO assets (key, filename, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET filename = excluded.filename, updated_at = excluded.updated_at`,
  ).run(key, filename, Date.now());
}

module.exports = { getPlayer, upsertPlayer, kvGet, kvSet, getAssets, setAsset };
