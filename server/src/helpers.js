/**
 * ตัวช่วยที่วางบนพื้น (ซื้อที่ร้าน หรือทีมเล็กได้ฟรีบนโต๊ะ — PLAYER_SCALE.freeTools)
 * ทำงานเฉพาะตอนอยู่บนพื้น (G.s.ground) — ถืออยู่/วางบนโต๊ะ = ไม่ทำงาน หยิบย้ายที่ได้เหมือนของทั่วไป
 *   สปริงเกอร์ 'tool:sprinkler' : ทุก SPRINKLER_EVERY_MS รดแปลงที่ไถแล้วในรัศมี SPRINKLER_RADIUS (≈3×3 ช่อง)
 *   หุ่นไล่กา  'tool:scarecrow' : แปลงในรัศมี SCARECROW_RADIUS ไม่โดนแมลงบุก (events.js ถาม G.guarded)
 */
const C = require('./content');

function attachHelpers(G) {
  const onGround = (k) => [...G.s.ground.values()].filter((g) => g.item.k === k);

  G.guarded = (plot) => onGround('tool:scarecrow').some((g) => Math.hypot(g.x - plot.x, g.y - plot.y) <= C.SCARECROW_RADIUS);

  G.onTick((now) => {
    let changed = false;
    for (const g of onGround('tool:sprinkler')) {
      if ((g.item.nextAt || 0) > now) continue;
      g.item.nextAt = now + C.SPRINKLER_EVERY_MS;
      let wet = 0;
      for (const p of G.s.plots) {
        if (p.soil !== 'tilled' || Math.hypot(p.x - g.x, p.y - g.y) > C.SPRINKLER_RADIUS) continue;
        G.moisten(p, now);
        wet++;
      }
      if (wet) {
        G.fx({ type: 'spray', x: g.x, y: g.y });
        changed = true;
      }
    }
    if (changed) G.markDirty();
  });
}

module.exports = { attachHelpers };
