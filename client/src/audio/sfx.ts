import { ac, buses, hiss, tone } from './engine'

/**
 * เสียงเอฟเฟกต์ทั้งหมด — โทนน่ารัก: เสียงป๊อป/ปิ๊ง/บุ๋ง สั้นๆ สูงๆ แหลมใส ไม่มีเสียงแข็งหรือดังตูม
 * แต่ละตัวเป็น (ctx, ปลายทาง) => void ปลายทางมีระดับเสียง + ซ้าย/ขวา ตามตำแหน่งในฉากแล้ว (director.ts)
 */
type Play = (c: AudioContext, d: AudioNode) => void

const rnd = (a: number, b: number) => a + Math.random() * (b - a)
// โน้ตที่ใช้บ่อย (Hz)
const N = { G5: 784, A5: 880, B5: 988, C6: 1047, D6: 1175, E6: 1319, G6: 1568, A6: 1760, C7: 2093, E7: 2637 }

function bubble(c: AudioContext, d: AudioNode, t: number, f: number, vol = 0.22) {
  tone(c, d, { t, f, f2: f * 1.9, dur: 0.07, vol })
}
function arp(c: AudioContext, d: AudioNode, notes: number[], gap: number, o: { t?: number; vol?: number; dur?: number; type?: OscillatorType } = {}) {
  notes.forEach((f, i) => tone(c, d, { t: (o.t ?? 0) + i * gap, f, dur: o.dur ?? 0.22, vol: o.vol ?? 0.2, type: o.type ?? 'triangle' }))
}
/** กระดิ่ง (FM เล็กๆ ให้มีประกายโลหะ) */
function bell(c: AudioContext, d: AudioNode, f: number, t = 0, dur = 0.9, vol = 0.18) {
  tone(c, d, { t, f, dur, vol })
  tone(c, d, { t, f: f * 2.76, dur: dur * 0.4, vol: vol * 0.3 })
  tone(c, d, { t, f: f * 5.4, dur: dur * 0.15, vol: vol * 0.12 })
}
function coin(c: AudioContext, d: AudioNode, t = 0, vol = 0.12) {
  tone(c, d, { t, f: N.B5, dur: 0.08, vol, type: 'square', lp: 5000 })
  tone(c, d, { t: t + 0.07, f: N.E6 * 1.0, dur: 0.32, vol, type: 'square', lp: 5000 })
}
function buzz(c: AudioContext, d: AudioNode, t: number, dur: number, vol = 0.1) {
  tone(c, d, { t, f: rnd(200, 240), f2: rnd(250, 300), dur, vol, type: 'sawtooth', vib: [rnd(22, 30), 18], lp: 1400, attack: 0.05, hold: dur * 0.6 })
}

export const SFX: Record<string, Play> = {
  // ── หยิบ/วาง/โยน ──
  pop: (c, d) => {
    const k = rnd(0.95, 1.08)
    tone(c, d, { f: 420 * k, f2: 1000 * k, dur: 0.09, vol: 0.45 })
    tone(c, d, { t: 0.03, f: 1500 * k, dur: 0.06, vol: 0.08, type: 'triangle' })
  },
  plop: (c, d) => {
    const k = rnd(0.95, 1.08)
    tone(c, d, { f: 760 * k, f2: 260 * k, dur: 0.11, vol: 0.4 })
    hiss(c, d, { dur: 0.05, vol: 0.08, filter: 'lowpass', f: 900 })
  },
  rustle: (c, d) => {
    hiss(c, d, { dur: 0.09, vol: 0.14, f: 3200, q: 1.5 })
    hiss(c, d, { t: 0.1, dur: 0.1, vol: 0.12, f: 2600, q: 1.5 })
    tone(c, d, { t: 0.12, f: 900, f2: 1400, dur: 0.07, vol: 0.2 })
  },
  whoosh: (c, d) => hiss(c, d, { dur: 0.28, vol: 0.3, f: 500, f2: 2600, q: 1.8, attack: 0.05 }),
  thud: (c, d) => {
    tone(c, d, { f: 190, f2: 70, dur: 0.14, vol: 0.5 })
    hiss(c, d, { dur: 0.07, vol: 0.14, filter: 'lowpass', f: 600 })
    tone(c, d, { t: 0.05, f: 620, f2: 820, dur: 0.06, vol: 0.12 }) // เด้งดึ๋ง
  },

  // ── ไร่ ──
  plant: (c, d) => {
    hiss(c, d, { dur: 0.06, vol: 0.12, filter: 'lowpass', f: 900 })
    tone(c, d, { f: 520, f2: 780, dur: 0.08, vol: 0.32 })
    tone(c, d, { t: 0.08, f: 780, f2: 1170, dur: 0.1, vol: 0.28 })
  },
  dig: (c, d) => {
    hiss(c, d, { dur: 0.08, vol: 0.28, filter: 'lowpass', f: rnd(800, 1100) })
    tone(c, d, { f: 150, f2: 70, dur: 0.09, vol: 0.35 })
  },
  tilled: (c, d) => {
    hiss(c, d, { dur: 0.2, vol: 0.25, f: 700, q: 0.8 })
    tone(c, d, { f: 220, f2: 110, dur: 0.15, vol: 0.4 })
    arp(c, d, [N.G5, N.C6], 0.07, { t: 0.1, vol: 0.14, dur: 0.14 })
  },
  pour: (c, d) => {
    bubble(c, d, 0, rnd(600, 1100), 0.14)
    bubble(c, d, 0.08, rnd(600, 1100), 0.12)
    hiss(c, d, { dur: 0.14, vol: 0.05, filter: 'highpass', f: 3000 })
  },
  water: (c, d) => {
    for (let i = 0; i < 5; i++) bubble(c, d, i * 0.05 + rnd(0, 0.02), rnd(500, 1200))
    hiss(c, d, { dur: 0.25, vol: 0.08, filter: 'highpass', f: 2500 })
  },
  splash: (c, d) => {
    hiss(c, d, { dur: 0.32, vol: 0.32, filter: 'lowpass', f: 2600, f2: 500 })
    for (let i = 0; i < 4; i++) bubble(c, d, 0.08 + i * 0.06, rnd(500, 1000))
  },
  swish: (c, d) => hiss(c, d, { dur: 0.1, vol: 0.22, f: 2500, f2: 7000, q: 2 }),
  harvest: (c, d) => {
    arp(c, d, [N.C6, N.E6, N.G6, N.C7], 0.055, { vol: 0.2, dur: 0.2 })
    tone(c, d, { t: 0.22, f: N.E7, dur: 0.3, vol: 0.06 })
  },
  ready: (c, d) => {
    tone(c, d, { f: N.C7, dur: 0.14, vol: 0.07 })
    tone(c, d, { t: 0.06, f: N.E7, dur: 0.2, vol: 0.06 })
  },
  shoo: (c, d) => {
    buzz(c, d, 0, 0.22, 0.12)
    hiss(c, d, { t: 0.18, dur: 0.16, vol: 0.28, filter: 'lowpass', f: 1400, f2: 300 })
    tone(c, d, { t: 0.2, f: 700, f2: 1400, dur: 0.1, vol: 0.2 })
  },
  pests: (c, d) => {
    buzz(c, d, 0, 0.6, 0.1)
    tone(c, d, { t: 0.05, f: 880, dur: 0.1, vol: 0.08, type: 'square', lp: 3000 })
    tone(c, d, { t: 0.2, f: 660, dur: 0.12, vol: 0.08, type: 'square', lp: 3000 })
  },
  trash: (c, d) => {
    tone(c, d, { f: 320, f2: 160, dur: 0.1, vol: 0.3, type: 'triangle' })
    tone(c, d, { t: 0.1, f: 240, f2: 110, dur: 0.13, vol: 0.28, type: 'triangle' })
    hiss(c, d, { dur: 0.12, vol: 0.12, filter: 'lowpass', f: 700 })
  },
  spray: (c, d) => {
    hiss(c, d, { dur: 0.3, vol: 0.06, filter: 'highpass', f: 4000, attack: 0.04 })
    bubble(c, d, 0.05, rnd(900, 1300), 0.05)
  },
  bees: (c, d) => {
    buzz(c, d, 0, 0.5, 0.07)
    tone(c, d, { t: 0.15, f: N.G6, dur: 0.12, vol: 0.06 })
  },
  gift: (c, d) => {
    tone(c, d, { f: 1900, f2: 500, dur: 0.6, vol: 0.12, vib: [9, 20] })
    SFX.thud(c, d)
    arp(c, d, [N.E6, N.G6, N.C7], 0.05, { t: 0.62, vol: 0.14 })
  },

  // ── สัตว์ ──
  feed: (c, d) => {
    tone(c, d, { f: 330, f2: 260, dur: 0.09, vol: 0.3, lp: 1200 })
    tone(c, d, { t: 0.13, f: 330, f2: 250, dur: 0.1, vol: 0.3, lp: 1200 })
    tone(c, d, { t: 0.26, f: N.E6, dur: 0.2, vol: 0.12, type: 'triangle' })
  },
  cluck: (c, d) => {
    for (let i = 0; i < 3; i++) tone(c, d, { t: i * 0.09, f: rnd(680, 760), f2: 1150, dur: 0.06, vol: 0.12, type: 'square', lp: 2400 })
    tone(c, d, { t: 0.3, f: 1000, f2: 560, dur: 0.18, vol: 0.14, type: 'square', lp: 2200 })
  },
  moo: (c, d) => tone(c, d, { f: 175, f2: 135, dur: 0.75, vol: 0.16, type: 'sawtooth', attack: 0.08, hold: 0.35, vib: [5, 3], lp: 450, lp2: 1100 }),

  // ── จุดแพ็ก / ออเดอร์ / เงิน ──
  pack: (c, d) => {
    hiss(c, d, { dur: 0.12, vol: 0.2, f: 1600, q: 2 })
    hiss(c, d, { t: 0.15, dur: 0.14, vol: 0.2, f: 1900, q: 2 })
  },
  packed: (c, d) => {
    bell(c, d, N.C7, 0, 0.6, 0.12)
    tone(c, d, { f: N.G6, dur: 0.15, vol: 0.08, type: 'triangle' })
  },
  deliver: (c, d) => {
    tone(c, d, { f: 660, dur: 0.09, vol: 0.28, type: 'triangle' })
    tone(c, d, { t: 0.09, f: 990, dur: 0.14, vol: 0.28, type: 'triangle' })
  },
  complete: (c, d) => {
    coin(c, d)
    arp(c, d, [784, 1047, 1319, 1568, 2093], 0.06, { t: 0.12, vol: 0.18, dur: 0.2 })
    for (const f of [1047, 1319, 1568]) tone(c, d, { t: 0.45, f, dur: 0.6, vol: 0.09, type: 'triangle' })
  },
  coin: (c, d) => coin(c, d),
  buy: (c, d) => {
    coin(c, d)
    arp(c, d, [N.C6, N.E6, N.G6, N.C7, N.E7], 0.045, { t: 0.1, vol: 0.12, dur: 0.16 })
  },
  order: (c, d) => {
    bell(c, d, N.G6, 0, 0.7, 0.13)
    bell(c, d, N.E6, 0.16, 0.9, 0.13)
  },
  expired: (c, d) => {
    ;[392, 370, 349].forEach((f, i) => tone(c, d, { t: i * 0.22, f, dur: 0.22, vol: 0.13, type: 'sawtooth', lp: 1100, attack: 0.02, hold: 0.12 }))
    tone(c, d, { t: 0.66, f: 330, f2: 300, dur: 0.6, vol: 0.13, type: 'sawtooth', lp: 1100, attack: 0.02, hold: 0.3, vib: [6, 8] })
  },

  // ── เหตุการณ์สุ่ม (ตอนเริ่ม) ──
  ev_rain: (c, d) => arp(c, d, [N.E6, N.D6, N.C6, N.A5, N.G5], 0.11, { vol: 0.13, dur: 0.35 }),
  ev_pests: (c, d) => {
    SFX.pests(c, d)
    tone(c, d, { t: 0.45, f: 880, dur: 0.1, vol: 0.08, type: 'square', lp: 3000 })
    tone(c, d, { t: 0.6, f: 660, dur: 0.12, vol: 0.08, type: 'square', lp: 3000 })
  },
  ev_rush: (c, d) => {
    for (let i = 0; i < 4; i++) tone(c, d, { t: i * 0.14, f: i % 2 ? 784 : 988, dur: 0.13, vol: 0.1, type: 'square', lp: 3500 })
  },
  ev_bees: (c, d) => {
    buzz(c, d, 0, 0.5, 0.08)
    arp(c, d, [N.C6, N.E6, N.G6, N.C7], 0.07, { t: 0.3, vol: 0.14 })
  },
  ev_gift: (c, d) => arp(c, d, [N.G5, N.C6, N.E6, N.G6, N.E6, N.G6, N.C7], 0.07, { vol: 0.13, dur: 0.18 }),
  ev_market: (c, d) => {
    coin(c, d)
    coin(c, d, 0.18)
    arp(c, d, [N.C6, N.D6, N.E6, N.G6], 0.06, { t: 0.4, vol: 0.13 })
  },

  // ── รอบ ──
  go: (c, d) => {
    ;[0, 0.45, 0.9].forEach((t) => tone(c, d, { t, f: 660, dur: 0.14, vol: 0.18, type: 'triangle' }))
    tone(c, d, { t: 1.35, f: 1320, dur: 0.45, vol: 0.2, type: 'triangle' })
    arp(c, d, [N.C6, N.E6, N.G6, N.C7], 0.05, { t: 1.4, vol: 0.1 })
  },
  tick: (c, d) => tone(c, d, { f: 1000, dur: 0.05, vol: 0.14, type: 'triangle' }),
  tock: (c, d) => tone(c, d, { f: 1500, dur: 0.08, vol: 0.2, type: 'triangle' }),
  timeup: (c, d) => {
    tone(c, d, { f: 2100, dur: 0.55, vol: 0.09, type: 'square', vib: [28, 120], lp: 4000, hold: 0.4 })
    arp(c, d, [N.C7, N.G6, N.E6, N.C6], 0.08, { t: 0.6, vol: 0.14 })
  },
  star: (c, d) => bell(c, d, N.C7, 0, 0.8, 0.16),

  // ── UI ──
  click: (c, d) => tone(c, d, { f: 1250, f2: 1500, dur: 0.035, vol: 0.12 }),
  open: (c, d) => {
    tone(c, d, { f: 500, f2: 950, dur: 0.1, vol: 0.28 })
    tone(c, d, { t: 0.06, f: N.E6, dur: 0.12, vol: 0.07, type: 'triangle' })
  },
  close: (c, d) => tone(c, d, { f: 900, f2: 480, dur: 0.09, vol: 0.22 }),
  error: (c, d) => {
    tone(c, d, { f: 260, dur: 0.08, vol: 0.2, type: 'triangle' })
    tone(c, d, { t: 0.1, f: 200, dur: 0.12, vol: 0.2, type: 'triangle' })
  },
  chat: (c, d) => {
    tone(c, d, { f: 1320, dur: 0.05, vol: 0.1 })
    tone(c, d, { t: 0.06, f: 1760, dur: 0.07, vol: 0.1 })
  },
}

/** เสียงดาวบนการ์ดสรุปผล: ทีละดวงสูงขึ้นเรื่อยๆ แล้วปิดด้วยแตร (ดีใจ/ปลอบใจ ตามจำนวนดาว) */
export function resultsJingle(stars: number, newBest: boolean) {
  const c = ac()
  if (!c) return
  const d = buses().sfx
  const notes = [N.C6, N.E6, N.G6]
  for (let i = 0; i < stars; i++) bell(c, d, notes[i] ?? N.C7, 0.7 + i * 0.4, 0.9, 0.17)
  const t = 0.8 + Math.max(stars, 1) * 0.4
  if (stars >= 2 || newBest) {
    arp(c, d, [N.C6, N.E6, N.G6, N.C7], 0.09, { t, vol: 0.15 })
    for (const f of [N.C6, N.E6, N.G6, N.C7]) tone(c, d, { t: t + 0.4, f, dur: 1.1, vol: 0.07, type: 'triangle' })
  } else {
    // "ไม่เป็นไรน้า" — ลงแล้วขึ้นเบาๆ
    arp(c, d, [N.G6, N.E6, N.D6], 0.14, { t, vol: 0.13, dur: 0.3 })
    tone(c, d, { t: t + 0.45, f: N.E6, dur: 0.6, vol: 0.12, type: 'triangle' })
  }
  if (newBest) arp(c, d, [N.C7, N.E7, N.C7, N.E7, 3136], 0.06, { t: t + 1.2, vol: 0.1, dur: 0.15 })
}
