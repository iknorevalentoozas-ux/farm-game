/**
 * ออเดอร์จับเวลา — ส่งที่รถทีละชิ้น (ของในมือ) ทุกคนช่วยกันเติมออเดอร์เดียวกันได้
 * รายการในออเดอร์เป็น item.k ตรงๆ ('box:<crop>' — ต้องแพ็กก่อน) ของดิบส่งไม่ได้ · สุ่มจากพืช + ของจากสัตว์ในแผนที่
 *
 * เวลา = 35 วิ + 8 วิ/ชิ้น + 1.0 × เวลาโตของพืชที่โตช้าสุด บีบไว้ 55–100 วิ แล้วบวกเผื่อ 10–30 วิตามขนาดออเดอร์
 *        (+20 วิ ถ้าเกิดใน 20 วิแรกของรอบ) → จริงๆ อยู่ราว 65–130 วิ
 * → ออเดอร์ง่ายราว 1 นาที ออเดอร์ยากได้เวลามากขึ้น (ตามที่ผู้ใช้ขอ)
 * ยิ่งเล่นไปนานในรอบ ออเดอร์ยิ่งใหญ่/หลายชนิด · ส่งเร็วได้โบนัส · หมดเวลาเสียคะแนน
 * จำนวนที่ค้างได้ / ระยะห่าง / ตัวคูณเวลา / เพดานความยาก มาจาก PLAYER_SCALE ตามจำนวนคนที่ออนไลน์ตอนนี้
 */
const C = require('./content');

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function attachOrders(G) {
  const { io, world } = G;

  G.onRoundStart((now) => {
    G.s.orders = [];
    G.s.nextOrderId = 1;
    G.s.lastOrderAt = now;
  });

  G.ordersView = () => ({
    orders: (G.s.orders || []).map((o) => ({
      id: o.id,
      items: o.items,
      reward: o.reward,
      expiresAt: o.expiresAt,
      totalSec: o.totalSec,
      rush: o.rush,
    })),
    serverNow: Date.now(),
  });
  const broadcast = () => io.emit('orders:list', G.ordersView());

  // 0–2 ตามเวลาที่ผ่านไปในรอบ แต่ไม่เกินเพดานของจำนวนคนตอนนี้ (คนเดียว = ชนิดเดียว ชิ้นเดียวตลอด)
  function difficulty(now) {
    const elapsed = 1 - (G.s.endsAt - now) / (C.ROUND_SEC * 1000);
    return Math.min(G.scale().maxDiff, Math.floor(elapsed * 3));
  }

  G.spawnOrder = ({ rush = false } = {}) => {
    const now = Date.now();
    const d = difficulty(now);
    const crops = [...G.s.level.crops, ...G.s.level.products];
    const kinds = 1 + Math.floor(Math.random() * Math.min(crops.length, d + 1));
    const items = {};
    let qtyTotal = 0;
    let slowest = 0;
    let reward = 0;
    for (const cid of shuffle(crops).slice(0, kinds)) {
      const qty = 1 + Math.floor(Math.random() * (1 + d));
      items[`box:${cid}`] = { need: qty, have: 0 };
      qtyTotal += qty;
      slowest = Math.max(slowest, G.growMs(cid) / 1000);
      reward += C.CROPS[cid].order * qty;
    }
    let sec = Math.max(C.ORDER_MIN_SEC, Math.min(C.ORDER_MAX_SEC, 35 + 8 * qtyTotal + slowest));
    sec += Math.min(C.ORDER_EXTRA_SEC[1], C.ORDER_EXTRA_SEC[0] + 5 * (qtyTotal - 1));
    // ช่วง 20 วิแรกของรอบยังไม่มีอะไรไถ/ปลูกไว้เลย ต้องเริ่มจากศูนย์ทั้งลูป ให้เวลาเพิ่ม
    if (now - (G.s.endsAt - C.ROUND_SEC * 1000) < 20000) sec += 20;
    sec *= G.scale().timeMul;
    if (rush) {
      sec = Math.max(35, sec * C.RUSH_TIME);
      reward = Math.round(reward * C.RUSH_REWARD);
    }
    sec = Math.round(sec);
    G.s.orders.push({ id: G.s.nextOrderId++, items, reward, totalSec: sec, expiresAt: now + sec * 1000, rush });
    G.s.lastOrderAt = now;
    broadcast();
  };

  /** ส่งของ 1 ชิ้นเข้าออเดอร์ที่ต้องการและใกล้หมดเวลาที่สุด — คืน true ถ้ารับไว้ (actions.js ล้างมือให้) */
  G.deliver = (socket, uuid, item) => {
    const order = [...G.s.orders]
      .sort((a, b) => a.expiresAt - b.expiresAt)
      .find((o) => o.items[item.k] && o.items[item.k].have < o.items[item.k].need);
    if (!order) {
      const hint = item.k.startsWith('crop:') ? 'ต้องแพ็กก่อนส่ง (ไปที่จุดแพ็ก 📦)' : 'ไม่มีออเดอร์ที่ต้องการของชิ้นนี้';
      G.toast(socket, hint);
      return false;
    }
    order.items[item.k].have += 1;
    const t = G.s.level.stations.find((s) => s.type === 'B');
    const done = Object.values(order.items).every((it) => it.have >= it.need);
    if (done) {
      const now = Date.now();
      const left = Math.max(0, (order.expiresAt - now) / (order.totalSec * 1000));
      const pay = order.reward + Math.round(order.reward * C.ORDER_TIME_BONUS * left);
      G.s.team.coins += pay;
      G.addScore(pay);
      G.s.completed += 1;
      G.s.orders = G.s.orders.filter((o) => o !== order);
      const name = world.getOnline(uuid)?.name || '';
      G.toastAll(`✅ ${name} ส่งออเดอร์ครบ! +${pay} 🪙`);
      G.fx({ type: 'coins', x: t?.x, y: t?.y, amount: pay });
      G.broadcastTeam();
      G.broadcastRound();
    }
    broadcast();
    return true;
  };

  G.onTick((now) => {
    const expired = G.s.orders.filter((o) => o.expiresAt <= now);
    if (expired.length) {
      G.s.orders = G.s.orders.filter((o) => o.expiresAt > now);
      G.s.failed += expired.length;
      const lost = G.scale().failPenalty * expired.length;
      G.addScore(-lost);
      G.toastAll(`⏰ ออเดอร์หมดเวลา ${expired.length} รายการ (−${lost} คะแนน)`);
      broadcast();
      G.broadcastRound();
    }
    const regular = G.s.orders.filter((o) => !o.rush).length;
    const sc = G.scale();
    if (regular < sc.orderMax && (regular === 0 || now - G.s.lastOrderAt >= sc.gapMs)) G.spawnOrder();
  });
}

module.exports = { attachOrders };
