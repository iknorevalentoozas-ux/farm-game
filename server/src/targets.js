/**
 * "เป้าหมาย" = สิ่งที่โต้ตอบได้ที่ใกล้จุดหน้าตัวละครที่สุด (ตามทิศที่หันล่าสุด)
 *
 * client ใช้สูตรเดียวกันใน client/src/input/target.ts เพื่อไฮไลต์และตั้งชื่อปุ่ม แล้วส่ง targetId มา —
 * server ไม่เลือกเป้าหมายเองซ้ำ แค่ตรวจว่ามีจริงและอยู่ในระยะ SERVER_REACH (กว้างกว่า CLIENT_REACH
 * เพราะตำแหน่งฝั่ง server ตามหลังจอเราเสมอ) — ถ้าให้ server เลือกเอง บางทีได้คนละอันกับที่ผู้เล่นเห็นไฮไลต์
 */
const AHEAD = 40; // จุดตรวจอยู่หน้าตัวละครกี่ px
const CLIENT_REACH = 80;
const SERVER_REACH = 115;

/** ทุกเป้าหมายในรอบนี้ { id, kind, x, y, ref } — kind: plot|counter|packer|animal|ground|shop|seeds|truck|pond|trash */
function listTargets(s) {
  const out = [];
  for (const p of s.plots) out.push({ id: p.id, kind: 'plot', x: p.x, y: p.y, ref: p });
  for (const c of s.counters) out.push({ id: c.id, kind: 'counter', x: c.x, y: c.y, ref: c });
  for (const k of s.packers) out.push({ id: k.id, kind: 'packer', x: k.x, y: k.y, ref: k });
  for (const a of s.animals) out.push({ id: a.id, kind: 'animal', x: a.x, y: a.y, ref: a });
  for (const g of s.ground.values()) out.push({ id: g.id, kind: 'ground', x: g.x, y: g.y, ref: g });
  const KIND = { S: 'shop', D: 'seeds', B: 'truck', W: 'pond', G: 'trash' };
  for (const st of s.level.stations) out.push({ id: st.id, kind: KIND[st.type], x: st.x, y: st.y, ref: st });
  return out;
}

function findTarget(s, id) {
  return listTargets(s).find((t) => t.id === id) || null;
}

module.exports = { listTargets, findTarget, AHEAD, CLIENT_REACH, SERVER_REACH };
