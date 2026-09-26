/**
 * เหตุการณ์สุ่มระหว่างรอบ — ทุก 40–55 วิ สุ่ม 1 อย่างตามน้ำหนักใน C.EVENTS (ของดีคูณ goodEvents ของ PLAYER_SCALE
 * → ทีมเล็กเจอของดีบ่อยกว่า):
 *   ฝนตก   : ดินที่ไถแล้วทุกแปลงชื้นฟรี (พืชโตต่อ) แต่พื้นแฉะ ทุกคนเดินช้าลงระหว่างฝนตก (speedMul ใน game.js)
 *   แมลงบุก: แปลงที่มีพืชกำลังโต (สูงสุด scale.pests แปลง ไม่รวมแปลงใกล้หุ่นไล่กา) ต้องมีคนกดที่แปลงนั้น
 *            เพื่อไล่ภายใน scale.pestMs ไม่งั้นพืชเสีย (ดินยังไถไว้อยู่ ปลูกใหม่ได้เลย)
 *   ออเดอร์ด่วน: ออเดอร์พิเศษเวลาน้อย ได้เงิน/คะแนนมากกว่า
 *   ผึ้ง   : พืชที่กำลังโตทุกแปลงโตพรวด BEES_BOOST ของเวลาโตทั้งหมด
 *   พัสดุ  : กล่องที่ออเดอร์ยังขาดอยู่ตกลงมาใกล้รถ (ไม่มีออเดอร์ค้าง = ได้เงิน GIFT_COINS แทน)
 *   ตลาดนัด: ร้านรับซื้อราคา ×MARKET_MUL ช่วง MARKET_MS
 */
const C = require('./content');
const { blockedAt } = require('./level');

const rand = (a, b) => a + Math.random() * (b - a);

function attachEvents(G) {
  G.onRoundStart((now) => {
    G.s.nextEventAt = now + rand(...C.EVENT_GAP_MS);
  });

  function pickType(growing) {
    if (C.FORCE_EVENT) return C.FORCE_EVENT;
    const good = G.scale().goodEvents;
    const opts = Object.entries(C.EVENTS)
      .filter(([type]) => !((type === 'pests' || type === 'rain' || type === 'bees') && !growing.length))
      .map(([type, e]) => [type, e.weight * (e.good ? good : 1)]);
    let r = Math.random() * opts.reduce((a, [, w]) => a + w, 0);
    for (const [type, w] of opts) if ((r -= w) <= 0) return type;
    return 'rush';
  }

  /** ช่องพื้นว่างใกล้รถที่สุดที่ยังไม่มีของวาง — ให้พัสดุตกตรงที่คนเห็นและเดินถึง */
  function giftSpot() {
    const L = G.s.level;
    const truck = L.stations.find((s) => s.type === 'B') || L.spawns[0];
    const cand = [];
    L.tiles.forEach((row, r) =>
      [...row].forEach((ch, c) => {
        if (ch !== '.' && ch !== '@') return;
        const x = c * L.tile + L.tile / 2;
        const y = r * L.tile + L.tile / 2;
        if (blockedAt(L, x, y)) return;
        if ([...G.s.ground.values()].some((g) => Math.hypot(g.x - x, g.y - y) < 30)) return;
        cand.push({ x, y, d: Math.hypot(x - truck.x, y - truck.y) });
      }),
    );
    cand.sort((a, b) => a.d - b.d);
    return cand[Math.floor(Math.random() * Math.min(4, cand.length))] || { x: truck.x, y: truck.y };
  }

  function start(now) {
    const growing = G.s.plots.filter((p) => p.crop && !G.plotReady(p, now) && !p.pestUntil);
    const type = pickType(growing);
    const sc = G.scale();

    if (type === 'rain') {
      for (const p of G.s.plots) if (p.soil === 'tilled') G.moisten(p, now);
      G.s.event = { type, until: now + C.RAIN_MS };
      G.toastAll('🌧️ ฝนตก! ดินชื้นทุกแปลง แต่พื้นแฉะ เดินช้าลง');
      G.broadcastTeam(); // speedMul เปลี่ยน
    } else if (type === 'pests') {
      const open = growing.filter((p) => !G.guarded(p));
      const victims = open.sort(() => Math.random() - 0.5).slice(0, sc.pests);
      if (!victims.length) {
        G.s.event = { type: 'pests', until: now + 3000 };
        G.toastAll('🐛 แมลงบินมา… แต่เจอหุ่นไล่กาเลยหนีไป 😎');
      } else {
        for (const p of victims) p.pestUntil = now + sc.pestMs;
        G.s.event = { type, until: now + sc.pestMs };
        G.toastAll(`🐛 แมลงบุก ${victims.length} แปลง! รีบไปไล่ก่อนพืชเสีย`);
      }
    } else if (type === 'bees') {
      for (const p of growing) {
        G.settlePlot(p, now);
        p.progressMs = Math.min(G.growMs(p.crop), p.progressMs + G.growMs(p.crop) * C.BEES_BOOST);
        G.fx({ type: 'bees', x: p.x, y: p.y });
      }
      G.s.event = { type, until: now + 4000 };
      G.toastAll(`🐝 ผึ้งมาช่วยผสมเกสร! พืช ${growing.length} แปลงโตพรวด`);
    } else if (type === 'gift') {
      const need = [];
      for (const o of G.s.orders) for (const [k, it] of Object.entries(o.items)) for (let i = it.have; i < it.need; i++) need.push(k);
      const spot = giftSpot();
      if (need.length) {
        const k = need[Math.floor(Math.random() * need.length)];
        G.dropGround(G.item(k), spot.x, spot.y);
        G.fx({ type: 'gift', x: spot.x, y: spot.y, k });
        G.toastAll('🎁 พัสดุตกจากฟ้า! มีกล่องที่ออเดอร์ต้องการอยู่ข้างรถ');
      } else {
        G.s.team.coins += C.GIFT_COINS;
        G.fx({ type: 'coins', x: spot.x, y: spot.y, amount: C.GIFT_COINS });
        G.toastAll(`🎁 พัสดุตกจากฟ้า! ได้เงิน +${C.GIFT_COINS} 🪙`);
        G.broadcastTeam();
      }
      G.s.event = { type, until: now + 4000 };
    } else if (type === 'market') {
      G.s.event = { type, until: now + C.MARKET_MS };
      G.toastAll(`🛒 ตลาดนัด! ร้านรับซื้อผลผลิตราคา ×${C.MARKET_MUL} ช่วงสั้นๆ`);
      G.broadcastTeam(); // sellMul เปลี่ยน
    } else {
      G.s.event = { type: 'rush', until: now + 3000 };
      G.spawnOrder({ rush: true });
      G.toastAll('⚡ ออเดอร์ด่วน! เวลาน้อย แต่ได้เงินเยอะ');
    }
    G.markDirty();
    G.broadcastRound();
  }

  G.onTick((now) => {
    const eaten = G.s.plots.filter((p) => p.pestUntil && now >= p.pestUntil);
    if (eaten.length) {
      for (const p of eaten) Object.assign(p, { crop: null, progressMs: 0, pestUntil: null });
      G.toastAll(`🐛 แมลงกินพืชไป ${eaten.length} แปลง`);
      G.markDirty();
    }
    if (G.s.event && now >= G.s.event.until) {
      const wasTeam = G.s.event.type === 'rain' || G.s.event.type === 'market';
      G.s.event = null;
      G.broadcastRound();
      if (wasTeam) G.broadcastTeam();
    }
    if (!G.s.event && now >= G.s.nextEventAt) {
      start(now);
      G.s.nextEventAt = now + rand(...C.EVENT_GAP_MS);
    }
  });
}

module.exports = { attachEvents };
