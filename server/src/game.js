/**
 * ตัวคุมรอบ (แบบ Overcooked) — ไม่มีห้อง: ทุกคนที่เข้ามาอยู่โลกเดียวกัน รอบเดียวกัน เข้ากลางรอบได้
 *
 *   idle ──(มีคนเข้า)──▶ playing (ROUND_SEC) ──▶ results (RESULTS_SEC) ──▶ playing (แผนที่ถัดไป) …
 *                         └──(ไม่มีใครออนไลน์)──▶ idle  (ไม่บันทึกคะแนน)
 *
 * สถานะทั้งรอบอยู่ใน `G.s` (ทิ้งเมื่อจบรอบ) — DB เก็บแค่ชื่อผู้เล่นกับคะแนนสูงสุดต่อแผนที่ (`best:<mapId>`)
 *   plots    แปลง: soil 'raw'|'tilled', crop, ความคืบหน้า (progressMs/moistUntil/lastTs — ดู settlePlot)
 *   counters โต๊ะ/ชั้นเครื่องมือ: วางของได้ 1 ชิ้น
 *   packers  จุดแพ็ก: วางผลผลิตดิบ 1 ชิ้น → ครบ G.packMs() กลายเป็นกล่อง
 *   animals  สัตว์: fed + readyAt (ให้อาหารแล้ว ได้ของเมื่อ now ≥ readyAt) — ดู actions.js
 *   ground   ของที่ตกอยู่บนพื้น (ทิ้ง/โยน/เก็บด้วยเคียว)
 *   held     ของในมือของแต่ละคน (ได้ทีละ 1 ชิ้น)
 *   work     งานที่กำลังยืนทำ (ไถ/รดน้ำ/เกี่ยว) — ดู actions.js
 *
 * ของบนแผนที่ส่งให้ client เป็นก้อน `level:state` ทั้งก้อน รวบการเปลี่ยนภายใน 100ms (markDirty)
 */
const C = require('./content');
const { parseLevel, moveWithCollision, collides } = require('./level');

const LEVELS = Object.fromEntries(Object.entries(C.MAPS).map(([id, def]) => [id, parseLevel(id, def, C.CROPS)]));
const TICK_MS = 250;
const PLAYER_COLORS = 8;
const FREE_TOOL_DELAY_MS = 8000;

function createGame(io, db, world) {
  const tickHooks = [];
  const roundStartHooks = [];
  let roundNo = Math.max(0, C.MAP_ROTATION.indexOf(C.START_MAP));
  let resultsTimer = null;
  let dirtyTimer = null;
  let nextUid = 1;
  let colorSeq = 0;

  const G = {
    io,
    db,
    world,
    s: { phase: 'idle', level: LEVELS[C.MAP_ROTATION[0]] },
    onTick: (fn) => tickHooks.push(fn),
    onRoundStart: (fn) => roundStartHooks.push(fn),
  };

  // อัปเกรดที่ซื้อแล้ว หรือที่ทีมเล็กได้ฟรีตอนนี้ (PLAYER_SCALE.freeUps — ตามจำนวนคนออนไลน์ตอนนี้ คนเข้าเพิ่มก็หายไป)
  G.hasUpgrade = (id) => !!G.s.team?.upgrades[id] || G.freeUps().includes(id);
  G.freeUps = () => (G.s.team ? C.playerScale(world.onlineCount()).freeUps : []);
  G.assistView = () => [...G.freeUps().map((u) => `up:${u}`), ...(G.s.freeTools || [])];
  G.canCap = () => C.CAN_CAP[G.hasUpgrade('big_can') ? 1 : 0];
  G.speedMul = () =>
    (G.hasUpgrade('boots') ? C.BOOTS_SPEED : 1) * G.s.level.walkMul * (G.s.event?.type === 'rain' ? C.RAIN_WALK : 1);
  G.growMs = (cropId) => C.CROPS[cropId].growMs * G.s.level.growMul;
  G.packMs = () => (G.hasUpgrade('fast_pack') ? C.FAST_PACK_MS : C.WORK_MS.pack);
  G.sellMul = () => (G.s.event?.type === 'market' ? C.MARKET_MUL : 1);
  G.playing = () => G.s.phase === 'playing';
  // ความยากตามจำนวนคน: ออเดอร์ใช้จำนวนคนตอนนี้, ดาวใช้ค่าเฉลี่ยทั้งรอบถ่วงตามเวลา (ดู PLAYER_SCALE)
  G.scale = () => C.playerScale(world.onlineCount());
  G.avgPlayers = () => (G.s.sampledMs ? G.s.playerMs / G.s.sampledMs : Math.max(1, world.onlineCount()));
  G.stars = () => {
    const mul = C.playerScale(G.avgPlayers()).starMul;
    return G.s.level.stars.map((x) => Math.round((x * mul) / 5) * 5);
  };
  G.nextColor = () => colorSeq++ % PLAYER_COLORS;

  G.item = (k, extra = {}) => ({ uid: nextUid++, k, ...extra });
  G.newTool = (id) => G.item(`tool:${id}`, id === 'can' ? { water: G.canCap() } : {});

  G.spawn = () => {
    const sp = G.s.level.spawns;
    const p = sp[Math.floor(Math.random() * sp.length)];
    return { x: p.x + (Math.random() - 0.5) * 20, y: p.y + (Math.random() - 0.5) * 20 };
  };
  G.move = (p, dx, dy) => moveWithCollision(G.s.level, p, dx, dy);
  G.collides = (x, y) => collides(G.s.level, x, y);
  G.toast = (target, text) => target.emit('farm:toast', { text });
  G.toastAll = (text) => io.emit('farm:toast', { text });
  G.fx = (payload) => io.emit('fx', payload);
  G.socketOf = (uuid) => [...io.sockets.sockets.values()].find((s) => s.data.uuid === uuid);

  // ── แปลง: โตเฉพาะช่วงที่ดินชื้น ────────────────────────────────────────
  /** เก็บเวลาชื้นที่ผ่านไปตั้งแต่ lastTs เข้า progressMs (เรียกก่อนแก้ moistUntil ทุกครั้ง) */
  G.settlePlot = (p, now) => {
    if (!p.crop) return;
    const until = Math.min(now, p.moistUntil || 0);
    if (until > p.lastTs) p.progressMs = Math.min(G.growMs(p.crop), p.progressMs + (until - p.lastTs));
    p.lastTs = now;
  };
  G.plotReady = (p, now) => {
    if (!p.crop) return false;
    G.settlePlot(p, now);
    return p.progressMs >= G.growMs(p.crop);
  };
  G.moisten = (p, now) => {
    G.settlePlot(p, now);
    p.moistUntil = Math.max(p.moistUntil || 0, now + C.MOIST_MS * G.scale().moistMul);
  };
  G.clearPlot = (p) => Object.assign(p, { soil: 'raw', crop: null, progressMs: 0, moistUntil: 0, lastTs: 0, pestUntil: null });

  // ── จุดแพ็ก: กลายเป็นกล่องเองเมื่อครบเวลา ──────────────────────────────
  G.settlePacker = (k, now) => {
    if (k.item && k.item.k.startsWith('crop:') && k.readyAt && now >= k.readyAt) {
      k.item.k = `box:${k.item.k.slice(5)}`;
      k.readyAt = null;
      return true;
    }
    return false;
  };

  G.dropGround = (item, x, y) => {
    const id = `i${item.uid}`;
    G.s.ground.set(id, { id, x, y, item });
    return id;
  };

  G.nearest = (list, p, radius) => {
    let best = null;
    let bestD = radius;
    for (const it of list) {
      const d = Math.hypot(it.x - p.x, it.y - p.y);
      if (d <= bestD) {
        best = it;
        bestD = d;
      }
    }
    return best;
  };

  // ── มุมมองที่ส่งให้ client ─────────────────────────────────────────────
  const itemView = (it) => (it ? { k: it.k, water: it.water, n: it.n } : null);

  G.levelStateView = () => {
    const now = Date.now();
    const s = G.s;
    return {
      plots: s.plots.map((p) => {
        G.settlePlot(p, now);
        return {
          id: p.id,
          soil: p.soil,
          crop: p.crop,
          progressMs: p.progressMs,
          growMs: p.crop ? G.growMs(p.crop) : 0,
          moistUntil: p.moistUntil,
          pestUntil: p.pestUntil,
        };
      }),
      counters: s.counters.map((c) => ({ id: c.id, item: itemView(c.item) })),
      packers: s.packers.map((k) => ({ id: k.id, item: itemView(k.item), readyAt: k.readyAt, total: k.total })),
      animals: s.animals.map((a) => ({ id: a.id, fed: a.fed, readyAt: a.readyAt, total: a.total })),
      ground: [...s.ground.values()].map((g) => ({ id: g.id, x: g.x, y: g.y, item: itemView(g.item) })),
      serverNow: now,
    };
  };

  G.markDirty = () => {
    if (dirtyTimer) return;
    dirtyTimer = setTimeout(() => {
      dirtyTimer = null;
      if (G.s.plots) io.emit('level:state', G.levelStateView());
    }, 100);
  };

  G.heldView = (uuid) => itemView(G.s.held?.get(uuid));
  G.workView = (uuid) => {
    const w = G.s.work?.get(uuid);
    return w ? { targetId: w.targetId, kind: w.kind, until: w.until, total: w.total } : null;
  };

  G.shopItems = () =>
    C.SHOP.map((it) => {
      const bought = G.s.team.bought[it.id] || 0;
      const free = it.id.startsWith('up:') && G.freeUps().includes(it.id.slice(3)) && !G.s.team.upgrades[it.id.slice(3)];
      return { id: it.id, emoji: it.emoji, name: it.name, desc: it.desc, price: bought >= it.max || free ? null : it.price, free };
    });

  G.teamView = () => ({
    coins: G.s.team.coins,
    canCap: G.canCap(),
    speedMul: G.speedMul(),
    fertilizer: G.hasUpgrade('fertilizer'),
    upgrades: [...new Set([...Object.keys(G.s.team.upgrades), ...G.freeUps()])],
    sellMul: G.sellMul(),
    shop: G.shopItems(),
  });

  G.roundView = () => {
    const s = G.s;
    return {
      id: s.id,
      phase: s.phase,
      endsAt: s.endsAt,
      mapId: s.level.id,
      mapName: s.level.name,
      theme: s.level.theme,
      stars: s.stars || G.stars(),
      players: Math.max(1, Math.round(G.avgPlayers())),
      score: s.score || 0,
      completed: s.completed || 0,
      failed: s.failed || 0,
      event: s.event || null,
      assist: G.assistView(),
      best: db.kvGet(`best:${s.level.id}`, 0),
      serverNow: Date.now(),
    };
  };

  G.levelView = () => {
    const L = G.s.level;
    return {
      id: L.id,
      theme: L.theme,
      tiles: L.tiles,
      tile: L.tile,
      cols: L.cols,
      rows: L.rows,
      w: L.w,
      h: L.h,
      plots: L.plots,
      counters: L.counters,
      packers: L.packers,
      animals: L.animals,
      stations: L.stations,
    };
  };

  G.catalog = () => ({
    crops: Object.fromEntries([...G.s.level.crops, ...G.s.level.products].map((id) => [id, { ...C.CROPS[id], growMs: G.growMs(id) }])),
    cropOrder: G.s.level.crops,
    products: G.s.level.products,
    allCrops: C.CROPS,
    animals: C.ANIMALS,
    tools: C.TOOLS,
  });

  G.broadcastTeam = () => io.emit('farm:team', G.teamView());
  G.broadcastRound = () => io.emit('round:update', G.roundView());

  /** ทุกอย่างที่ client ต้องใช้สร้างฉากรอบนี้ — ส่งตอน join และตอนเริ่มรอบใหม่ (client สร้างฉากใหม่ทั้งหมด) */
  G.snapshot = () => ({
    level: G.levelView(),
    state: G.levelStateView(),
    round: G.roundView(),
    team: G.teamView(),
    catalog: G.catalog(),
    orders: G.ordersView().orders,
    serverNow: Date.now(),
  });

  G.addScore = (n) => {
    G.s.score = Math.max(0, (G.s.score || 0) + n);
  };

  function startRound() {
    clearTimeout(resultsTimer);
    const mapId = C.MAP_ROTATION[roundNo % C.MAP_ROTATION.length];
    roundNo += 1;
    const level = LEVELS[mapId];
    const now = Date.now();
    const counters = level.counters.map((c) => ({ ...c, item: null }));
    const racks = counters.filter((c) => c.rack);
    G.s = {
      id: roundNo,
      phase: 'playing',
      level,
      endsAt: now + C.ROUND_SEC * 1000,
      startedAt: now,
      freeTools: null,
      team: { coins: C.START_COINS, upgrades: {}, bought: {} },
      plots: level.plots.map((p) => ({ ...p, soil: 'raw', crop: null, progressMs: 0, moistUntil: 0, lastTs: 0, pestUntil: null })),
      counters,
      packers: level.packers.map((k) => ({ ...k, item: null, readyAt: null, total: 0 })),
      animals: level.animals.map((a) => ({ ...a, fed: false, readyAt: null, total: 0 })),
      ground: new Map(),
      held: new Map(),
      work: new Map(),
      score: 0,
      completed: 0,
      failed: 0,
      event: null,
      playerMs: 0,
      sampledMs: 0,
      stars: null,
    };
    level.tools.forEach((t, i) => {
      racks[i].item = G.newTool(t);
    });
    for (const fn of roundStartHooks) fn(now);
    for (const socket of io.sockets.sockets.values()) {
      const uuid = socket.data.uuid;
      if (!uuid || !world.getOnline(uuid)) continue;
      world.teleport(uuid, G.spawn());
      socket.emit('round:start', { ...G.snapshot(), you: world.getOnline(uuid) });
    }
  }

  /**
   * เครื่องมือฟรีของทีมเล็ก (PLAYER_SCALE.freeTools) — ให้ครั้งเดียวต่อรอบ หลังเริ่มรอบ FREE_TOOL_DELAY_MS
   * (คนที่เข้าพร้อมกันจะได้นับครบก่อน ไม่งั้นคนแรกที่ join เปิดรอบ = ถูกนับเป็นเล่นคนเดียวทุกครั้ง)
   * ทีมใหญ่ตอนนั้น = ยังไม่ให้ แต่ถ้าคนออกจนเหลือทีมเล็กกลางรอบ ก็ได้ตอนนั้น
   */
  function checkFreeTools(now) {
    if (G.s.freeTools || now - G.s.startedAt < FREE_TOOL_DELAY_MS) return;
    const list = C.playerScale(world.onlineCount()).freeTools;
    if (!list.length) return;
    for (const id of list) {
      const free = G.s.counters.find((c) => !c.item && !c.rack) || G.s.counters.find((c) => !c.item);
      if (free) free.item = G.newTool(id.slice(5));
    }
    G.s.freeTools = list;
    const names = list.map((id) => C.SHOP.find((x) => x.id === id)).filter(Boolean).map((x) => `${x.emoji} ${x.name}`);
    G.toastAll(`🤝 ทีมเล็กได้ตัวช่วยฟรี: ${names.join(' · ')} (อยู่บนโต๊ะ)`);
    G.markDirty();
    G.broadcastRound();
  }

  function clearWork() {
    for (const w of G.s.work?.values() || []) clearTimeout(w.timer);
    G.s.work?.clear();
  }

  function endRound() {
    const s = G.s;
    s.phase = 'results';
    clearWork();
    const thresholds = G.stars();
    const stars = thresholds.filter((x) => s.score >= x).length;
    const prevBest = db.kvGet(`best:${s.level.id}`, 0);
    if (s.score > prevBest) db.kvSet(`best:${s.level.id}`, s.score);
    const next = LEVELS[C.MAP_ROTATION[roundNo % C.MAP_ROTATION.length]];
    io.emit('round:end', {
      score: s.score,
      stars,
      thresholds,
      players: Math.max(1, Math.round(G.avgPlayers())),
      completed: s.completed,
      failed: s.failed,
      best: Math.max(prevBest, s.score),
      newBest: s.score > prevBest,
      mapName: s.level.name,
      nextMapName: next.name,
      nextAt: Date.now() + C.RESULTS_SEC * 1000,
      serverNow: Date.now(),
    });
    G.broadcastRound();
    resultsTimer = setTimeout(() => {
      if (world.onlineCount() > 0) startRound();
      else G.s.phase = 'idle';
    }, C.RESULTS_SEC * 1000);
  }

  /** เรียกก่อน world ส่ง snapshot ให้คนที่เพิ่ง join — ถ้าไม่มีรอบเดินอยู่ ก็เริ่มรอบใหม่ให้ */
  G.ensureRound = () => {
    if (G.s.phase === 'idle') startRound();
  };

  /** คนออกกลางรอบ: ของในมือตกพื้นตรงที่ยืน (เครื่องมือจะได้ไม่หายไปจากรอบ) */
  G.onLeave = (uuid, pos) => {
    if (!G.playing()) return;
    const w = G.s.work.get(uuid);
    if (w) clearTimeout(w.timer);
    G.s.work.delete(uuid);
    const it = G.s.held.get(uuid);
    G.s.held.delete(uuid);
    if (it && pos) {
      G.dropGround(it, pos.x, pos.y);
      G.markDirty();
    }
  };

  setInterval(() => {
    if (G.s.phase !== 'playing') return;
    if (world.onlineCount() === 0) {
      clearWork();
      G.s.phase = 'idle';
      return;
    }
    const now = Date.now();
    if (now >= G.s.endsAt) return endRound();
    G.s.playerMs += world.onlineCount() * TICK_MS;
    G.s.sampledMs += TICK_MS;
    checkFreeTools(now);
    const stars = G.stars();
    const assist = String(G.assistView());
    if (assist !== G.s.assistKey) {
      G.s.assistKey = assist; // ตัวช่วยฟรีเปลี่ยนตามจำนวนคน — อัปเกรดมีผลกับร้าน/บัว ส่งทีมใหม่ด้วย
      G.broadcastTeam();
      G.broadcastRound();
    }
    if (String(stars) !== String(G.s.stars)) {
      G.s.stars = stars; // เกณฑ์ดาวเลื่อนตามคนเข้า/ออก — ส่งให้ทุกคนเห็นทันที
      G.broadcastRound();
    }
    let changed = false;
    for (const k of G.s.packers) if (G.settlePacker(k, now)) changed = true;
    if (changed) G.markDirty();
    for (const fn of tickHooks) fn(now);
  }, TICK_MS);

  return G;
}

module.exports = { createGame };
