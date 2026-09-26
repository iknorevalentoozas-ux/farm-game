/**
 * ผู้เล่นที่ออนไลน์ + การเดิน — ไม่รู้จักกติกาฟาร์มเลย ได้ทุกอย่างที่เกี่ยวกับแผนที่/รอบผ่าน hook ใน attach()
 *
 * **การเดิน: client บอกตำแหน่งตัวเอง server แค่ตรวจว่าเป็นไปได้** — player:move {dx, dy, x, y} ตอนเปลี่ยนทิศ
 * + ทุก 100ms ระหว่างเดิน + ตอนหยุด ถ้า (x,y) ไม่ทะลุกำแพงและไม่ไกลเกินความเร็ว → รับเลย, ไม่งั้นตอบ
 * you:correct {x,y} ให้ client วาร์ปกลับ (เกมร่วมมือ ไม่ต้องกันโกงตำแหน่ง)
 *   เดิมให้ server ขยับเองตาม "ทิศที่กด" แล้ว client ค่อยๆ ดึงเข้าหา — บนเน็ตมือถือ (RTT 100–300ms) ปล่อยจอย
 *   แล้วตัวละครไถลต่อ, เดินอยู่ server ตามหลังหลายสิบ px → กดทำอะไรตอนเพิ่งถึงโดน "ไกลเกินไป" ("ช้าๆ แปลกๆ")
 * ไม่มี x,y (เช่นบอททดสอบ) = ใช้แบบเดิม: server ขยับตาม intent ใน tick
 *
 * **ทนเน็ตแกว่ง** (เล่นบน Render + เน็ตมือถือแล้ว "เดินไปละติด กระตุก"): แพ็กเก็ตที่ค้างแล้วมาถึงพร้อมกันเคย
 * ถูกตรวจทีละก้อนด้วยเวลาที่ห่างกันแค่ ~0ms → โดนปัดตก → you:correct วาร์ปกลับ → แพ็กเก็ตเก่าที่ยังค้างท่ออยู่
 * (ส่งจากตำแหน่งก่อนวาร์ป) ก็โดนปัดตกต่อเป็นลูกโซ่ แก้สองจุด:
 *   - ระยะที่ยอมให้เดินเป็น "งบ" สะสมตามเวลา (token bucket, สะสมได้ถึง BUDGET_SEC) ไม่ใช่ต่อแพ็กเก็ต
 *     ช่วงเน็ตค้างงบก็สะสมไว้ แพ็กเก็ตที่ทะลักมาพร้อมกันผ่านหมด
 *   - you:correct มีเลขรอบ cid (เก็บใน entry, ไปกับ snapshot) client แนบ cid ล่าสุดที่ได้มากับทุก player:move
 *     แพ็กเก็ตที่ cid ไม่ตรง = ส่งก่อนวาร์ป → ทิ้งเงียบๆ (ไม่ตอบ correct ซ้ำ)
 * ทดสอบ: scratch script จำลองเน็ตค้าง 2% ของแพ็กเก็ต 0.3–1.2s — เดิม 25 วิ โดนวาร์ปกลับ 16 ครั้ง
 * ห้ามกลับไปใช้ "ก้าว N px ต่อ event" — ตำแหน่ง server เพี้ยน ~25% ตาม frame rate
 *
 * ตำแหน่งไม่เก็บลง DB แล้ว — แผนที่เปลี่ยนทุกรอบ เข้ามาใหม่เกิดที่จุดเกิดของแผนที่ปัจจุบันเสมอ
 */
const TICK_MS = 100;
// ต้องเท่ากับ PREDICT_SPEED ใน client/src/scenes/FarmScene.ts (ทั้งคู่คูณ speedMul ของทีม)
const SPEED_PPS = 220;
const INTENT_TTL_MS = 400; // ไม่ได้ยินจาก client เกินนี้ถือว่าปล่อยแล้ว (กันเดินไม่หยุดถ้าแพ็กเก็ตหาย)
const BUDGET_RATE = 1.3; // งบระยะเดินสะสม = ความเร็วจริง × นี้ ต่อวินาที
const BUDGET_SEC = 2.5; // สะสมได้สูงสุดเท่าเดิน ~2.5 วิ (เน็ตค้างนานกว่านี้แล้วทะลักมาทีเดียวถึงจะโดนวาร์ป)
const BUDGET_SLACK = 48; // px เผื่อเฟรมไม่สม่ำเสมอ/ความเร็วเปลี่ยนตอนฝนตก

const CHAT_KEEP = 80;

const online = new Map(); // uuid -> { uuid, name, x, y }
// แชทย้อนหลัง (ฟาร์ม + ห้องจริง) ให้คนที่เพิ่งเปิดเกมเห็นว่าคุยอะไรกันอยู่ — ขอผ่าน chat:hello
const chatLog = [];
function pushChat(msg) {
  chatLog.push(msg);
  if (chatLog.length > CHAT_KEEP) chatLog.splice(0, chatLog.length - CHAT_KEEP);
}
const intent = new Map(); // uuid -> { dx, dy, at } เฉพาะคนที่ไม่ส่ง x,y (บอท) — tick ขยับให้
const posBudget = new Map(); // uuid -> { at, left } งบระยะเดินที่เหลือของคนที่ client ขับเอง

/**
 * hooks:
 *   onFarmChat(msg)       — มีคนพิมพ์แชทในเกม (index.js ส่งต่อเข้าห้อง YelloTalk ผ่าน bridge)
 *   onJoin()              — ก่อนส่ง snapshot ให้คนเพิ่งเข้า (game.js เริ่มรอบถ้ายังว่าง)
 *   getExtraSnapshot(uuid) — ข้อมูลเกมที่ merge เข้า world:snapshot (ส่งพร้อมกันกัน race ตอนเพิ่งต่อ)
 *   getSpawn()            — จุดเกิดในแผนที่ปัจจุบัน
 *   move(p, dx, dy)       — ขยับ p พร้อมเช็คชนกำแพงของแผนที่ปัจจุบัน
 *   getSpeedMul()         — ตัวคูณความเร็วของทีม (รองเท้า/แผนที่/ฝนตก)
 *   decorate(p)           — ข้อมูลต่อผู้เล่นที่ต้องไปกับ world:state (ของในมือ, งานที่กำลังทำ)
 *   nextColor()           — สีเสื้อผู้เล่นคนใหม่ (index)
 *   onLeave(uuid, pos)    — คนออก (game.js ทิ้งของในมือลงพื้น)
 *   collides(x, y)        — จุดนี้ทับกำแพง/สิ่งของในแผนที่ปัจจุบันไหม (ตรวจตำแหน่งที่ client ส่งมา)
 *   getRoom()             — ข้อมูลห้อง YelloTalk (ชื่อห้อง/คนในห้อง/หลุม) จาก bridge หรือ null ถ้าไม่มีสะพาน
 * entry = { uuid, name, x, y, fx, fy (ทิศที่หันล่าสุด — ใช้หาเป้าหมาย/ทิศโยน), color, cid (เลข you:correct ล่าสุด),
 *           ct (นาฬิกาของ client เจ้าของตัว ตอนอยู่ที่ x,y — คนอื่นใช้ interpolate ตามจังหวะที่เจ้าตัวเดินจริง) }
 */
function attach(io, db, hooks) {
  const view = (p) => ({ ...p, ...hooks.decorate(p.uuid) });

  io.on('connection', (socket) => {
    socket.on('player:join', ({ uuid, name } = {}) => {
      if (!uuid) return;
      const row = db.upsertPlayer({ uuid, name });
      hooks.onJoin();
      const prev = online.get(uuid);
      const entry = prev || { uuid, name: row.name, ...hooks.getSpawn(), fx: 0, fy: 1, color: hooks.nextColor(), cid: 0 };
      entry.name = row.name;
      online.set(uuid, entry);
      socket.data.uuid = uuid;

      socket.emit('world:snapshot', {
        you: view(entry),
        players: [...online.values()].map(view),
        ...hooks.getExtraSnapshot(uuid),
      });
      if (!prev) socket.broadcast.emit('world:playerJoined', view(entry));
    });

    socket.on('player:move', ({ dx, dy, x, y, cid, t } = {}) => {
      const uuid = socket.data.uuid;
      if (!uuid || !online.has(uuid)) return;
      const hasPos = Number.isFinite(x) && Number.isFinite(y);
      // cid ไม่ตรง = ส่งมาก่อน client ได้ you:correct ล่าสุด (ยังค้างท่ออยู่) → ทิ้งทั้งก้อน รวมทิศที่หัน
      // client เก่าที่ไม่ส่ง cid ยังใช้ได้ (ไม่มีการกันลูกโซ่ให้)
      if (hasPos && cid != null && cid !== online.get(uuid).cid) return;
      if (hasPos && acceptPosition(socket, uuid, x, y) && Number.isFinite(t)) online.get(uuid).ct = t;
      let ix = Number(dx) || 0;
      let iy = Number(dy) || 0;
      const len = Math.hypot(ix, iy);
      if (len > 1) {
        ix /= len;
        iy /= len;
      }
      if (!hasPos) intent.set(uuid, { dx: ix, dy: iy, at: Date.now() });
      if (ix || iy) {
        const p = online.get(uuid);
        const l = Math.hypot(ix, iy);
        p.fx = ix / l;
        p.fy = iy / l;
      }
    });

    /** ตำแหน่งจาก client: รับถ้าไม่ทับกำแพงและระยะไม่เกินงบที่สะสมไว้ (ดูหัวไฟล์) */
    function acceptPosition(sock, uuid, x, y) {
      const p = online.get(uuid);
      const now = Date.now();
      const rate = SPEED_PPS * hooks.getSpeedMul() * BUDGET_RATE;
      const b = posBudget.get(uuid) || { at: now, left: rate * BUDGET_SEC };
      b.left = Math.min(rate * BUDGET_SEC, b.left + (rate * (now - b.at)) / 1000);
      b.at = now;
      posBudget.set(uuid, b);
      const dist = Math.hypot(x - p.x, y - p.y);
      if (dist <= b.left + BUDGET_SLACK && !hooks.collides(x, y)) {
        p.x = x;
        p.y = y;
        b.left = Math.max(0, b.left - dist);
        return true;
      }
      p.cid = (p.cid || 0) + 1;
      sock.emit('you:correct', { x: p.x, y: p.y, cid: p.cid });
      return false;
    }

    socket.on('chat:send', ({ text } = {}) => {
      const uuid = socket.data.uuid;
      const p = uuid && online.get(uuid);
      const clean = String(text || '').trim().slice(0, 500);
      if (!p || !clean) return;
      const msg = { source: 'farm', name: p.name, text: clean, t: Date.now() };
      pushChat(msg);
      io.emit('chat:message', msg);
      hooks.onFarmChat(msg);
    });

    // แผงแชทฝั่ง client พร้อมแล้ว (mount หลัง world:snapshot) — ส่งแชทย้อนหลัง + ข้อมูลห้องให้
    socket.on('chat:hello', () => {
      socket.emit('chat:history', { messages: chatLog, room: hooks.getRoom() });
    });

    socket.on('disconnect', () => {
      const uuid = socket.data.uuid;
      if (!uuid || !online.has(uuid)) return;
      // uuid เดียวกันอาจเปิดไว้หลายแท็บ — ลบออกเฉพาะตอนไม่เหลือ socket ของ uuid นี้แล้ว
      const stillHere = [...io.sockets.sockets.values()].some((s) => s.id !== socket.id && s.data.uuid === uuid);
      if (stillHere) return;
      const p = online.get(uuid);
      hooks.onLeave(uuid, { x: p.x, y: p.y });
      online.delete(uuid);
      intent.delete(uuid);
      posBudget.delete(uuid);
      io.emit('world:playerLeft', { uuid });
    });
  });

  let lastTick = Date.now();
  setInterval(() => {
    const now = Date.now();
    const dt = Math.min(now - lastTick, 250) / 1000; // เพดานกันกระโดดทะลุกำแพงถ้า event loop ค้างนาน
    lastTick = now;
    const speed = SPEED_PPS * hooks.getSpeedMul();
    for (const [uuid, it] of intent) {
      const p = online.get(uuid);
      if (!p || now - it.at > INTENT_TTL_MS) continue;
      hooks.move(p, it.dx * speed * dt, it.dy * speed * dt);
    }
    // t = เวลา server — client ใช้วาดคนอื่นแบบหน่วงไว้นิดแล้ว interpolate (เน็ตแกว่งแล้วไม่กระตุก)
    if (online.size) io.emit('world:state', { t: now, players: [...online.values()].map(view) });
  }, TICK_MS);
}

/** ข้อความจากห้อง YelloTalk จริง (ผ่าน bridge) — กระจายให้ client ทุกคนเห็น */
function broadcastRoomChat(io, msg) {
  const m = { source: 'room', name: msg.name, text: msg.text, t: msg.t || Date.now() };
  pushChat(m);
  io.emit('chat:message', m);
}

/** แชทย้อนหลังจาก backend ตอน bridge เพิ่งต่อติด — ใช้เฉพาะตอนยังไม่มีอะไรในบันทึก (กันซ้ำตอน reconnect) */
function seedChat(list) {
  if (chatLog.length) return;
  for (const m of list.slice(-CHAT_KEEP)) pushChat(m);
}

/** ห้องจริงเปลี่ยน (คนเข้า/ออก, ขึ้น/ลงหลุม, เปิดปิดไมค์) — ส่งให้ทุกคนทั้งก้อน */
function broadcastRoomInfo(io, room) {
  io.emit('room:info', room);
}

const getOnline = (uuid) => online.get(uuid);
const onlineCount = () => online.size;
/** ย้ายผู้เล่นไปจุดใหม่ทันที (ตอนเริ่มรอบใหม่ แผนที่เปลี่ยน) และล้างทิศที่ค้างอยู่ */
function teleport(uuid, pos) {
  const p = online.get(uuid);
  if (!p) return;
  p.x = pos.x;
  p.y = pos.y;
  intent.delete(uuid);
  posBudget.delete(uuid);
  // ตำแหน่งจากแผนที่เก่าที่ยังค้างในท่อ cid ไม่ตรงแล้ว → ถูกทิ้ง (cid ใหม่ไปกับ you ใน round:start)
  p.cid = (p.cid || 0) + 1;
}

module.exports = { attach, broadcastRoomChat, broadcastRoomInfo, seedChat, getOnline, onlineCount, teleport };
