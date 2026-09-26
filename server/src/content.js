/**
 * ข้อมูลเกมล้วนๆ — ปรับบาลานซ์/แผนที่ที่ไฟล์นี้ไฟล์เดียว client ไม่ hardcode อะไรซ้ำ (ได้รับผ่าน snapshot)
 *
 * เกมเป็นรอบแบบ Overcooked: ทุกรอบเริ่มจากศูนย์ วัดกันที่คะแนนรอบนั้น แผนที่หมุนตาม MAP_ROTATION
 * ผู้เล่นถือของได้ทีละ 1 ชิ้น (item.k ดูรูปแบบด้านล่าง) วางบนโต๊ะ/พื้น/โยนส่งต่อกันได้
 *
 * item.k:  'seed:<crop>'  ถุงเมล็ด (item.n = ปลูกได้อีกกี่แปลง)   'crop:<crop>'  ผลผลิตดิบ (รวมไข่/นม)
 *          'box:<crop>'   กล่องแพ็กแล้ว (ส่งรถได้)                 'feed:grain'   อาหารสัตว์ (item.n เหมือนเมล็ด)
 *          'tool:hoe'     จอบ (ไถดิน)    'tool:can'     บัวรดน้ำ (มี item.water)   'tool:sickle' เคียว
 *          'tool:sprinkler' สปริงเกอร์ / 'tool:scarecrow' หุ่นไล่กา — ตัวช่วย ทำงานเองตอนวางอยู่บนพื้น (ดู helpers.js)
 */

// growMs = เวลาที่ต้อง "ชื้น" จนโตเต็ม (โตเฉพาะตอนดินชื้น ดู MOIST_MS) — seed = ค่าเมล็ด (เงินทีม)
// sell = ขายที่ร้าน (ไม่ได้คะแนน), order = ต่อกล่องเมื่อส่งออเดอร์
// แครอท/ผักกาดเมล็ดฟรี: ทุกแผนที่มีอย่างน้อยหนึ่งตัว ทีมเงินหมดก็ยังปลูกหาเงินต่อได้ ไม่ติดตาย
// ของจากสัตว์ (animal ≠ undefined) ใช้ id/emoji/ราคาแบบเดียวกัน แต่ growMs = เวลาหลังให้อาหารจนได้ของ
const CROPS = {
  carrot: { id: 'carrot', name: 'แครอท', emoji: '🥕', growMs: 12000, seed: 0, sell: 3, order: 12 },
  lettuce: { id: 'lettuce', name: 'ผักกาด', emoji: '🥬', growMs: 15000, seed: 0, sell: 4, order: 14 },
  tomato: { id: 'tomato', name: 'มะเขือเทศ', emoji: '🍅', growMs: 20000, seed: 3, sell: 6, order: 18 },
  corn: { id: 'corn', name: 'ข้าวโพด', emoji: '🌽', growMs: 24000, seed: 4, sell: 7, order: 22 },
  strawberry: { id: 'strawberry', name: 'สตรอว์เบอร์รี่', emoji: '🍓', growMs: 22000, seed: 5, sell: 8, order: 24 },
  pumpkin: { id: 'pumpkin', name: 'ฟักทอง', emoji: '🎃', growMs: 30000, seed: 6, sell: 10, order: 30 },
  egg: { id: 'egg', name: 'ไข่ไก่', emoji: '🥚', growMs: 14000, seed: 0, sell: 4, order: 14, animal: 'chicken' },
  milk: { id: 'milk', name: 'นมวัว', emoji: '🥛', growMs: 20000, seed: 0, sell: 6, order: 20, animal: 'cow' },
};

/**
 * สัตว์ (ช่อง H = ไก่, M = วัว — ทึบ ยืนข้างๆ แล้วหันเข้าหา): ถืออาหารสัตว์ (ฟรีที่กล่องเมล็ด) กด "ให้อาหาร"
 * → อีก CROPS[product].growMs ได้ของ → มือว่างกด "เก็บ" → หิวใหม่ ไม่ต้องไถ/รดน้ำ ทางลัดของทีมเล็ก
 */
const ANIMALS = {
  chicken: { id: 'chicken', name: 'ไก่', emoji: '🐔', product: 'egg', tile: 'H' },
  cow: { id: 'cow', name: 'วัว', emoji: '🐄', product: 'milk', tile: 'M' },
};

const TOOLS = {
  hoe: { id: 'hoe', name: 'จอบ', emoji: '⛏️' },
  can: { id: 'can', name: 'บัวรดน้ำ', emoji: '🚿' },
  sickle: { id: 'sickle', name: 'เคียว', emoji: '🔪' },
  sprinkler: { id: 'sprinkler', name: 'สปริงเกอร์', emoji: '💦', gadget: true },
  scarecrow: { id: 'scarecrow', name: 'หุ่นไล่กา', emoji: '🧑‍🌾', gadget: true },
};

/**
 * แผนที่ tile 64px — ตัวอักษรละ 1 ช่อง (ทุกบรรทัดยาวเท่ากัน level.js ตรวจตอนบูต)
 *   #  รั้ว   T  ต้นไม้/หิน   W  บ่อน้ำ (เติมบัว)   S  ร้านค้า   K  จุดแพ็ก   B  รถส่งออก
 *   C  โต๊ะ (วางของได้ 1 ชิ้น)   R  ชั้นเครื่องมือ (โต๊ะที่เริ่มรอบมาพร้อมเครื่องมือ)   D  กล่องเมล็ด (+อาหารสัตว์)
 *   G  ถังขยะ   P  แปลงดิน   H  ไก่   M  วัว   @  จุดเกิด   .  พื้น
 * ทุกอย่างยกเว้น P . @ เป็นช่องทึบ เดินทะลุไม่ได้ — ต้องยืนข้างๆ แล้วหันเข้าหา
 * tools = เครื่องมือที่วางบนชั้น R ตามลำดับตอนเริ่มรอบ
 */
const MAPS = {
  starter: {
    name: 'ฟาร์มเริ่มต้น',
    theme: 'grass',
    crops: ['carrot', 'lettuce', 'tomato'],
    growMul: 1,
    walkMul: 1,
    stars: [120, 280, 480], // ที่ 4 คน — น้อยกว่านี้คูณ starMul (PLAYER_SCALE)
    tools: ['hoe', 'can', 'can', 'sickle'],
    tiles: [
      '##################',
      '#T..WW.......T...#',
      '#...WW...........#',
      '#..PPPP..PPPP....#',
      '#..PPPP..PPPP..CB#',
      '#..............CB#',
      '#.RRRR...@.......#',
      '#..............KC#',
      '#.DD...G.......KC#',
      '#.S..............#',
      '#T....HH........T#',
      '##################',
    ],
  },
  spring: {
    name: 'ฟาร์มซากุระ',
    theme: 'spring',
    crops: ['carrot', 'tomato', 'strawberry'],
    growMul: 1,
    walkMul: 1,
    stars: [120, 280, 480],
    tools: ['hoe', 'can', 'can', 'sickle'],
    tiles: [
      '##################',
      '#T..PPP.WW.PPP..T#',
      '#...PPP.WW.PPP...#',
      '#...............C#',
      '#RRRR....@......B#',
      '#...............B#',
      '#HH.............C#',
      '#.....DD.G..KK...#',
      '#M..............S#',
      '#T....T....T....T#',
      '##################',
    ],
  },
  desert: {
    name: 'ฟาร์มทะเลทราย',
    theme: 'desert',
    crops: ['carrot', 'corn', 'pumpkin'],
    growMul: 1.25, // ดินแห้ง พืชโตช้า และบ่อน้ำอยู่ไกล
    walkMul: 1,
    stars: [120, 280, 480],
    tools: ['hoe', 'can', 'can', 'sickle'],
    tiles: [
      '##################',
      '#T.........T...WW#',
      '#..PPP..PPP....WW#',
      '#..PPP..PPP......#',
      '#..PPP..PPP..T...#',
      '#................#',
      '#RRRR....@....CCB#',
      '#...............B#',
      '#DD..G....KK.....#',
      '#S.....M.....T...#',
      '##################',
    ],
  },
  snow: {
    name: 'ฟาร์มหิมะ',
    theme: 'snow',
    crops: ['lettuce', 'strawberry', 'pumpkin'],
    growMul: 1,
    walkMul: 0.85, // หิมะหนา เดินช้า
    stars: [120, 280, 480],
    tools: ['hoe', 'can', 'can', 'sickle'],
    tiles: [
      '##################',
      '#..PPPP....PPPP.K#',
      '#..PPPP....PPPP.K#',
      '#@...............#',
      '#.....TWWWT......#',
      '#RRRR.TWWWT.....C#',
      '#...............B#',
      '#..DD..G........B#',
      '#S........@....C.#',
      '#T...H....M.....T#',
      '##################',
    ],
  },
};
const MAP_ROTATION = ['starter', 'spring', 'desert', 'snow'];

// ร้านค้า (ของทีม ใช้ได้ถึงจบรอบ) — tool:* = ซื้อเครื่องมือ/ตัวช่วยเพิ่มอีกชิ้น วางบนโต๊ะว่างใกล้ร้าน
// ตัวช่วยราคาถูกกว่าเครื่องมือ: ทีมเล็กควรซื้อได้ตั้งแต่ออเดอร์แรกๆ
const SHOP = [
  { id: 'tool:sprinkler', name: 'สปริงเกอร์', emoji: '💦', desc: 'วางไว้กลางแปลง รดน้ำแปลงรอบตัวให้เอง', price: 20, max: 2 },
  { id: 'tool:scarecrow', name: 'หุ่นไล่กา', emoji: '🧑‍🌾', desc: 'วางใกล้แปลง แมลงไม่กล้าเข้าใกล้', price: 15, max: 1 },
  { id: 'up:seed_bag', name: 'ถุงเมล็ดใหญ่', emoji: '🎒', desc: 'หยิบเมล็ด/อาหารสัตว์ครั้งเดียว ใช้ได้ 3 ครั้ง', price: 15, max: 1 },
  { id: 'up:good_soil', name: 'ไส้เดือนดิน', emoji: '🪱', desc: 'เก็บเกี่ยวแล้วดินยังร่วน ปลูกต่อได้เลย', price: 25, max: 1 },
  { id: 'up:fast_pack', name: 'เครื่องแพ็กไว', emoji: '⚙️', desc: 'แพ็กเสร็จใน 0.6 วิ (จาก 1.5)', price: 20, max: 1 },
  { id: 'up:big_can', name: 'บัวใหญ่', emoji: '💧', desc: 'บัวทุกอันจุน้ำ 6 ครั้ง (จาก 3)', price: 20, max: 1 },
  { id: 'up:boots', name: 'รองเท้าบูท', emoji: '👢', desc: 'ทุกคนเดินเร็วขึ้น 30%', price: 30, max: 1 },
  { id: 'up:fertilizer', name: 'ปุ๋ย', emoji: '🌿', desc: 'เก็บเกี่ยวได้ +1 ผลต่อแปลง', price: 40, max: 1 },
  { id: 'tool:can', name: 'บัวรดน้ำเพิ่ม', emoji: '🚿', desc: 'เพิ่มบัวอีก 1 อัน', price: 15, max: 2 },
  { id: 'tool:hoe', name: 'จอบเพิ่ม', emoji: '⛏️', desc: 'เพิ่มจอบอีก 1 อัน', price: 20, max: 2 },
  { id: 'tool:sickle', name: 'เคียวเพิ่ม', emoji: '🔪', desc: 'เพิ่มเคียวอีก 1 อัน', price: 20, max: 1 },
];

// FARM_ROUND_SEC / FARM_RESULTS_SEC / FARM_EVENT_GAP_MS / FARM_FORCE_EVENT / FARM_START_MAP: ใช้กับ server ทดสอบเท่านั้น
const ROUND_SEC = Number(process.env.FARM_ROUND_SEC) || 360; // 6 นาที (เดิม 3 — ผู้ใช้ขอ +3 นาทีทุกด่าน)
const RESULTS_SEC = Number(process.env.FARM_RESULTS_SEC) || 12;
const START_COINS = 40; // บอทเล่นทะเลทรายแล้วเงินหมดซื้อเมล็ดข้าวโพด/ฟักทองไม่ได้ — เมล็ดถูกลง + เริ่ม 40
const CAN_CAP = [3, 6];
const BOOTS_SPEED = 1.3;
const SEED_BAG_USES = 3;

// งานที่ต้องยืนทำจนเสร็จ (ms)
const WORK_MS = { till: 1200, water: 500, reap: 400, pack: 1500 };
const FAST_PACK_MS = 600;
const MOIST_MS = 12000; // รดน้ำหนึ่งครั้ง ดินชื้น (พืชโต) นานเท่านี้ (× moistMul ตามจำนวนคน)
const THROW_TILES = 3;

// ตัวช่วยที่วางบนพื้น (helpers.js)
const SPRINKLER_RADIUS = 100; // px จากตัวสปริงเกอร์ถึงกลางแปลง — ~3×3 ช่องรอบตัว
const SPRINKLER_EVERY_MS = 4000;
const SCARECROW_RADIUS = 170;

// ออเดอร์: ง่าย ≤ 1 นาที ยากได้เวลาเพิ่ม (ตามที่ผู้ใช้ขอ) — ยากขึ้นเรื่อยๆ ตามเวลาที่ผ่านไปในรอบ
// จำนวน/ความถี่/ขนาดออเดอร์ และเกณฑ์ดาว ปรับตามจำนวนคนที่เล่นอยู่ (PLAYER_SCALE ด้านล่าง)
const ORDER_MIN_SEC = 55;
const ORDER_MAX_SEC = 100;
// เวลาเผื่อบวกเพิ่มหลังบีบช่วงแล้ว (ผู้ใช้ขอ +10–30 วิ) — ออเดอร์ 1 ชิ้นได้ +10, ใหญ่ขึ้นชิ้นละ +5, สูงสุด +30
const ORDER_EXTRA_SEC = [10, 30];
const ORDER_TIME_BONUS = 0.5;

/**
 * ความยากตามจำนวนคน (ผู้ใช้: "สองคนทำไม่ทัน ตายพอดี", "ถ้าคนเล่นน้อยต้องไม่ยาก") — key = จำนวนคนออนไลน์ (5 = 5+)
 *   orderMax  ออเดอร์ปกติค้างพร้อมกันได้สูงสุด (ส่งหมด = ออเดอร์ใหม่มาทันที ไม่ต้องรอ gap)
 *   gapMs     เว้นระยะออเดอร์ถัดไปเมื่อยังมีค้างอยู่
 *   timeMul   คูณเวลาของแต่ละออเดอร์
 *   maxDiff   เพดานความยาก 0–2 (0 = ชนิดเดียว ชิ้นเดียว, 2 = หลายชนิด หลายชิ้น) ตามเวลาในรอบ
 *   starMul   คูณเกณฑ์ดาวของแผนที่ (ใช้จำนวนคนเฉลี่ยตลอดรอบ ถ่วงตามเวลา — เข้า/ออกกลางรอบไม่เอาเปรียบ)
 *   failPenalty  คะแนนที่เสียเมื่อออเดอร์หมดเวลา
 *   moistMul  คูณเวลาดินชื้นหลังรด (ทีมเล็กรดน้อยครั้งกว่า)
 *   pests / pestMs  แมลงบุกได้กี่แปลง / มีเวลาไล่กี่ ms
 *   goodEvents   คูณโอกาสเหตุการณ์ดี (ผึ้ง/พัสดุ/ตลาด) — ทีมเล็กเจอของดีบ่อยกว่า
 *   freeUps   อัปเกรดที่ได้ฟรีตราบที่คนออนไลน์เท่านี้ (คนเข้าเพิ่ม = หายไป, ซื้อไว้แล้วอยู่ถาวร)
 *   freeTools ตัวช่วยฟรีวางบนโต๊ะ ครั้งเดียวต่อรอบ (game.js checkFreeTools — รอ 8 วิหลังเริ่มรอบให้คนเข้าครบก่อน)
 * วัดด้วย scripts/playbot.js รอบ 6 นาที 4 แผนที่ — ค่าเดิม (ไม่มีตัวช่วย): 1 บอทส่งได้ 5–8 หมดเวลา 3–4,
 * 2 บอทบนหิมะส่งได้ 3 หมดเวลา 6 (0 ดาว) · ค่านี้: 1 บอทส่งได้ 4–9 หมดเวลา 0–1 (2–3 ดาว),
 * 2 บอทส่งได้ 5–9 หมดเวลา 1–3 (1–2 ดาว)
 */
const PLAYER_SCALE = {
  1: { orderMax: 2, gapMs: 45000, timeMul: 1.6, maxDiff: 1, starMul: 0.35, failPenalty: 4, moistMul: 1.6, pests: 1, pestMs: 20000, goodEvents: 2.5, freeUps: ['seed_bag', 'good_soil'], freeTools: ['tool:sprinkler'] },
  2: { orderMax: 2, gapMs: 30000, timeMul: 1.4, maxDiff: 1, starMul: 0.55, failPenalty: 5, moistMul: 1.35, pests: 2, pestMs: 16000, goodEvents: 1.8, freeUps: ['seed_bag'], freeTools: ['tool:sprinkler'] },
  3: { orderMax: 3, gapMs: 20000, timeMul: 1.15, maxDiff: 2, starMul: 0.8, failPenalty: 8, moistMul: 1.15, pests: 3, pestMs: 13000, goodEvents: 1.2, freeUps: [], freeTools: [] },
  4: { orderMax: 3, gapMs: 15000, timeMul: 1, maxDiff: 2, starMul: 1, failPenalty: 10, moistMul: 1, pests: 3, pestMs: 12000, goodEvents: 1, freeUps: [], freeTools: [] },
  5: { orderMax: 4, gapMs: 12000, timeMul: 1, maxDiff: 2, starMul: 1.2, failPenalty: 10, moistMul: 1, pests: 3, pestMs: 12000, goodEvents: 1, freeUps: [], freeTools: [] },
};
const playerScale = (n) => PLAYER_SCALE[Math.max(1, Math.min(5, Math.round(n) || 1))];

// เหตุการณ์สุ่ม — ทุก 40–55 วิ สุ่ม 1 อย่างตามน้ำหนัก (good = คูณ goodEvents ของ PLAYER_SCALE)
const EVENT_GAP_MS = process.env.FARM_EVENT_GAP_MS ? process.env.FARM_EVENT_GAP_MS.split(',').map(Number) : [40000, 55000];
const EVENTS = {
  rain: { weight: 2 },
  pests: { weight: 2 },
  rush: { weight: 2 },
  bees: { weight: 1, good: true }, // 🐝 พืชที่กำลังโตทุกแปลงโตพรวด BEES_BOOST ของเวลาทั้งหมด
  gift: { weight: 1, good: true }, // 🎁 กล่องที่ออเดอร์ต้องการตกจากฟ้าใกล้รถ (ไม่มีออเดอร์ = เงิน)
  market: { weight: 1, good: true }, // 🛒 ร้านรับซื้อราคา ×MARKET_MUL ช่วงสั้นๆ
};
const FORCE_EVENT = process.env.FARM_FORCE_EVENT || null;
const START_MAP = process.env.FARM_START_MAP || null; // ทดสอบเท่านั้น: รอบแรกเริ่มที่แผนที่นี้
const RAIN_MS = 15000;
const RAIN_WALK = 0.8;
const RUSH_TIME = 0.6;
const RUSH_REWARD = 1.5;
const BEES_BOOST = 0.35;
const GIFT_COINS = 15;
const MARKET_MS = 20000;
const MARKET_MUL = 2;

module.exports = {
  CROPS,
  ANIMALS,
  TOOLS,
  MAPS,
  MAP_ROTATION,
  SHOP,
  ROUND_SEC,
  RESULTS_SEC,
  START_COINS,
  CAN_CAP,
  BOOTS_SPEED,
  SEED_BAG_USES,
  WORK_MS,
  FAST_PACK_MS,
  MOIST_MS,
  THROW_TILES,
  SPRINKLER_RADIUS,
  SPRINKLER_EVERY_MS,
  SCARECROW_RADIUS,
  PLAYER_SCALE,
  playerScale,
  ORDER_MIN_SEC,
  ORDER_MAX_SEC,
  ORDER_EXTRA_SEC,
  ORDER_TIME_BONUS,
  EVENT_GAP_MS,
  EVENTS,
  FORCE_EVENT,
  START_MAP,
  RAIN_MS,
  RAIN_WALK,
  RUSH_TIME,
  RUSH_REWARD,
  BEES_BOOST,
  GIFT_COINS,
  MARKET_MS,
  MARKET_MUL,
};
