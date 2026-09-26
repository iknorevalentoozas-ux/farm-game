/**
 * asset ที่แอดมินอัปโหลด (โมเดล .glb แทนของในฉาก 3D) — key ตามใจ (เช่น 'player', 'crop-carrot-2')
 * server ไม่รู้ว่า key ไหนเกมใช้ทำอะไร แค่เก็บ key -> ไฟล์ ให้ client ไปดึงไปโหลดเอง
 * ไม่มีระบบล็อกอิน: ตั้ง ADMIN_TOKEN แล้วการอัปโหลดต้องส่ง header `x-admin-token` ตรงกัน (ต้องตั้งเสมอ
 * เมื่อ server เปิดสู่ภายนอก เช่นบน Render) — ไม่ตั้ง = อัปโหลดได้ทุกคน (โหมด dev บนเครื่อง)
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');

// มี FARM_DATA_DIR (เช่น disk ถาวรบน Render) → เก็บไฟล์อัปโหลดไว้ในนั้นด้วย ไม่งั้นหายทุกครั้งที่ deploy
const UPLOAD_DIR = process.env.FARM_DATA_DIR
  ? path.join(process.env.FARM_DATA_DIR, 'uploads')
  : path.join(__dirname, '..', 'public', 'assets', 'uploads');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// .glb = โมเดล 3D แทนรูปทรงที่เกมสร้างจากโค้ด (client/src/render/overrides.ts) — รูปภาพยังรับไว้เผื่อใช้ทำ UI
const ALLOWED_EXT = new Set(['.glb', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);
const KEY_RE = /^[a-zA-Z0-9_-]{1,64}$/;

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      // ชื่อไฟล์ขึ้นกับ key + เวลา (กัน browser cache รูปเก่าตอนอัปโหลดทับ key เดิม)
      cb(null, `${req.params.key}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = KEY_RE.test(req.params.key) && ALLOWED_EXT.has(path.extname(file.originalname).toLowerCase());
    cb(null, ok);
  },
});

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN || req.get('x-admin-token') === ADMIN_TOKEN) return next();
  res.status(401).json({ error: 'ต้องใส่ ADMIN_TOKEN', needToken: true });
}

function attach(app, db) {
  app.use('/assets/uploads', express.static(UPLOAD_DIR));

  app.get('/api/assets', (_req, res) => {
    const assets = {};
    for (const row of db.getAssets()) assets[row.key] = `/assets/uploads/${row.filename}`;
    res.json({ assets });
  });

  app.post('/api/assets/:key', requireAdmin, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'key ไม่ถูกต้อง หรือไฟล์ไม่รองรับ (.glb หรือรูปภาพ ≤ 10MB)' });
    const old = db.getAssets().find((a) => a.key === req.params.key);
    db.setAsset(req.params.key, req.file.filename);
    if (old) fs.unlink(path.join(UPLOAD_DIR, old.filename), () => {});
    res.json({ ok: true, url: `/assets/uploads/${req.file.filename}` });
  });
}

module.exports = { attach };
