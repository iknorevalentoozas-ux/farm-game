/**
 * สะพานเชื่อมออกไปหา backend เดิมของ yellotalk-bot (bot-server.js, พอร์ต 5353)
 *
 * ต่อเป็น socket.io-client แบบเดียวกับที่ web-portal/app/game/page.tsx ทำ (io(url) เฉยๆ ไม่ต้อง
 * auth เพราะ backend เปิด CORS ทุก origin ให้แล้ว)
 *
 *   ข้อมูลห้อง   'bot-state-update' {botId, state} — มี botId กำกับ (filter ได้) และมีครบในก้อนเดียว:
 *                state.currentRoom (ชื่อห้อง/เจ้าของ), state.participants (คนในห้อง),
 *                state.speakers (10 หลุม ตาม position — ว่าง = uuid null, ล็อก = locked), state.messages
 *                ตอนต่อติดดึง GET /api/bot/status/:botId หนึ่งครั้งด้วย (event นี้มาเฉพาะตอนมีอะไรเปลี่ยน)
 *   แชทสด      'new-message' {botId, sender, message} — filter ด้วย botId เพราะ event นี้กระจายของทุกบอท
 *
 * **ข้อความที่ฟาร์มส่งเข้าห้อง (`🌾 ชื่อ: ข้อความ`) จะวนกลับมาทาง new-message** (backend addMessageForBot
 * ทุกข้อความที่บอทส่งเอง) — ต้องทิ้ง ไม่งั้นคนพิมพ์ในฟาร์มเห็นข้อความตัวเองซ้ำสองครั้ง
 */
const { io: ioClient } = require('socket.io-client');

const FARM_PREFIX = '🌾 ';

/** รูปหน้าโปรไฟล์ — ชื่อ field ต่างกันไปตามที่มา (แบบเดียวกับ web-portal/components/control/user-avatar.tsx) */
const avatarOf = (p) => p?.head_image || p?.headImage || p?.avatar || p?.avatar_suit?.image_url || null;
const person = (p) => ({ uuid: p.uuid, name: p.pin_name || p.name || 'User', avatar: avatarOf(p) });

/** ข้อความในห้อง → ข้อความแชทของเกม (ข้อความที่ฟาร์มส่งเข้าไปเองแปลงกลับเป็น source 'farm') */
function toChat(sender, text) {
  if (text.startsWith(FARM_PREFIX)) {
    const body = text.slice(FARM_PREFIX.length);
    const i = body.indexOf(': ');
    if (i > 0) return { source: 'farm', name: body.slice(0, i), text: body.slice(i + 2) };
  }
  return { source: 'room', name: sender, text };
}

function createBridge({ url, botId, onRoomChat, onRoomInfo, onHistory }) {
  let room = { topic: null, owner: null, participants: [], speakers: [] };
  let roomKey = '';
  let connected = false;
  let seeded = false;

  const socket = ioClient(url, { reconnection: true, transports: ['websocket', 'polling'] });

  function applyState(st) {
    if (!st) return;
    const owner = st.currentRoom?.owner?.uuid ? person(st.currentRoom.owner) : null;
    // state.participants ของ backend ไม่มีหัวห้อง (มาแยกใน currentRoom.owner) — ใส่ไว้บนสุดเอง
    // ไม่งั้นหน้าเลือกชื่อ/แท็บ 👥 ไม่มีหัวห้องให้เลือก
    const others = (st.participants || []).filter((p) => p && p.uuid && p.uuid !== owner?.uuid).map(person);
    const next = {
      topic: st.currentRoom?.topic || null,
      owner,
      participants: owner ? [owner, ...others] : others,
      // หลุมบนเวที 10 ช่อง — เก็บทุกช่อง (ว่าง/ล็อก) ให้ client วาดครบ 10 ช่องเหมือนในแอป
      speakers: (st.speakers || []).map((s, i) => ({
        position: s.position ?? i,
        locked: !!s.locked,
        uuid: s.uuid || null,
        name: s.uuid ? s.pin_name : null,
        avatar: s.uuid ? avatarOf(s) : null,
        muted: s.mic_muted !== false,
      })),
    };
    const key = JSON.stringify(next);
    if (key !== roomKey) {
      roomKey = key;
      room = next;
      onRoomInfo && onRoomInfo(room);
    }
    // ประวัติแชทย้อนหลังจาก backend — ใช้ครั้งเดียวตอนเพิ่งต่อ (หลังจากนั้นมาทาง new-message ทีละข้อความ)
    if (!seeded && Array.isArray(st.messages)) {
      seeded = true;
      onHistory && onHistory(st.messages.map((m) => ({ ...toChat(m.sender || '', m.message || ''), t: Date.now() })));
    }
  }

  async function refresh() {
    try {
      const res = await fetch(`${url}/api/bot/status/${botId}`);
      if (res.ok) applyState(await res.json());
    } catch (e) {
      console.error('[bridge] refresh failed:', e.message);
    }
  }

  socket.on('connect', () => {
    connected = true;
    console.log(`[bridge] connected to backend at ${url} (botId=${botId})`);
    refresh();
  });
  socket.on('disconnect', () => {
    connected = false;
    console.log('[bridge] disconnected from backend');
  });
  socket.on('connect_error', (err) => {
    console.error('[bridge] connect_error:', err.message);
  });

  socket.on('bot-state-update', (data) => {
    if (data && data.botId === botId) applyState(data.state);
  });

  socket.on('new-message', (data) => {
    if (!data || data.botId !== botId) return;
    const text = String(data.message || '');
    if (text.startsWith(FARM_PREFIX)) return; // เสียงสะท้อนของข้อความที่ฟาร์มส่งเข้าห้องเอง
    onRoomChat && onRoomChat({ name: data.sender, text, t: Date.now() });
  });

  // กันพลาด event: ดึงซ้ำเป็นระยะ (applyState แจ้งเฉพาะตอนมีอะไรเปลี่ยนจริง)
  const pollTimer = setInterval(refresh, 15000);

  return {
    getParticipants: () => room.participants,
    getRoom: () => room,
    sendToRoom: (message) => {
      if (!connected) return false;
      socket.emit('send-message', { botId, message });
      return true;
    },
    isConnected: () => connected,
    stop: () => {
      clearInterval(pollTimer);
      socket.disconnect();
    },
    FARM_PREFIX,
  };
}

module.exports = { createBridge, FARM_PREFIX };
