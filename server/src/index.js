/**
 * farm-game server — entrypoint. โปรเจคอิสระ ไม่ import โค้ดจาก backend/ เลย คุยกันแค่ผ่าน
 * network (ดู bridge.js) รันคู่กับ backend เดิมได้ตลอดเวลา คนละพอร์ต
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const db = require('./db');
const world = require('./world');
const { createGame } = require('./game');
const { attachActions } = require('./actions');
const { attachOrders } = require('./orders');
const { attachEvents } = require('./events');
const { attachHelpers } = require('./helpers');
const assets = require('./assets');
const { createBridge } = require('./bridge');

const PORT = process.env.PORT || 5454;
const BRIDGE_URL = process.env.BRIDGE_URL || 'http://localhost:5353';
const BRIDGE_BOT_ID = process.env.BRIDGE_BOT_ID || '';
// โชว์แชทจากห้อง YelloTalk ในแชทเกมไหม — ค่าเริ่มต้นปิด ต้องตั้ง =true ถึงจะโชว์
// (ปิดอยู่ก็ยังส่งแชทฟาร์มเข้าห้อง และแท็บคนในห้อง/หลุมยังใช้ได้ตามปกติ)
const BRIDGE_SHOW_ROOM_CHAT = process.env.BRIDGE_SHOW_ROOM_CHAT === 'true';

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ['GET', 'POST'], credentials: true },
});

let bridge = null;
if (BRIDGE_BOT_ID) {
  bridge = createBridge({
    url: BRIDGE_URL,
    botId: BRIDGE_BOT_ID,
    onRoomChat: (msg) => {
      if (BRIDGE_SHOW_ROOM_CHAT) world.broadcastRoomChat(io, msg);
    },
    onRoomInfo: (room) => world.broadcastRoomInfo(io, room),
    // ประวัติย้อนหลังมีทั้งข้อความห้องและข้อความฟาร์มที่ส่งเข้าไป — ปิดอยู่เก็บแค่ของฟาร์ม
    onHistory: (list) => world.seedChat(BRIDGE_SHOW_ROOM_CHAT ? list : list.filter((m) => m.source === 'farm')),
  });
} else {
  console.warn('[farm-game] BRIDGE_BOT_ID ไม่ได้ตั้งใน .env — รันแบบไม่มีสะพานเชื่อมห้องจริง (โหมด dev)');
}

const game = createGame(io, db, world);
attachActions(game);
attachOrders(game);
attachEvents(game);
attachHelpers(game);
world.attach(io, db, {
  onFarmChat: (msg) => {
    if (bridge) bridge.sendToRoom(`${bridge.FARM_PREFIX}${msg.name}: ${msg.text}`);
  },
  onJoin: game.ensureRound,
  getExtraSnapshot: game.snapshot,
  getSpawn: game.spawn,
  move: game.move,
  collides: game.collides,
  getSpeedMul: game.speedMul,
  decorate: (uuid) => ({ held: game.heldView(uuid), work: game.workView(uuid) }),
  nextColor: game.nextColor,
  onLeave: game.onLeave,
  getRoom: () => (bridge ? bridge.getRoom() : null),
});
assets.attach(app, db);

// หน้า /admin/ และรูปที่อัปโหลด (public/assets/uploads)
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, bridgeConnected: bridge ? bridge.isConnected() : false });
});

app.get('/api/participants', (_req, res) => {
  res.json({ participants: bridge ? bridge.getParticipants() : [], ownerUuid: bridge?.getRoom().owner?.uuid || null });
});

server.listen(PORT, () => {
  console.log(`🌾 farm-game server listening on :${PORT}`);
});
