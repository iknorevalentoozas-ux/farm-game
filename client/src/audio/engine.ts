/**
 * แกนเสียง (WebAudio) — ไม่มีไฟล์เสียงเลย ทุกเสียง/เพลงสังเคราะห์สดในโค้ด (แบบเดียวกับโมเดลใน models.ts)
 *
 *   master ─ compressor ─ ลำโพง
 *     ├─ musicBus  (เพลง — ปิดได้ด้วยปุ่ม 🎵, จำใน localStorage `farm.music`)
 *     └─ sfxBus    (เสียงเอฟเฟกต์ — ปุ่ม 🔊, `farm.sfx`)
 *
 * เบราว์เซอร์ไม่ยอมให้เล่นเสียงก่อนผู้ใช้แตะจอ — สร้าง AudioContext ตอนแตะ/กดปุ่มครั้งแรก (หน้า login ก็นับ)
 * แท็บถูกซ่อน = suspend (setInterval ของตัวต่อเพลงโดนหน่วงเหลือ 1 ครั้ง/วิ เพลงจะกระตุก) กลับมาแล้ว resume
 */
const MUSIC_KEY = 'farm.music'
const SFX_KEY = 'farm.sfx'
const MUSIC_VOL = 0.34
const SFX_VOL = 0.85

function readFlag(key: string) {
  try {
    return localStorage.getItem(key) !== '0'
  } catch {
    return true
  }
}

export const settings = { music: readFlag(MUSIC_KEY), sfx: readFlag(SFX_KEY) }

let ctx: AudioContext | null = null
let musicBus: GainNode
let sfxBus: GainNode
let noiseBuf: AudioBuffer
const readyFns: (() => void)[] = []

/** AudioContext ที่กำลังเล่นอยู่ — null = ยังไม่ปลดล็อก/แท็บซ่อน (อย่าตั้งเวลาเล่นตอนนั้น ไม่งั้นดังพร้อมกันตอน resume) */
export function ac(): AudioContext | null {
  return ctx && ctx.state === 'running' ? ctx : null
}
export const buses = () => ({ music: musicBus, sfx: sfxBus })
export const noise = () => noiseBuf

/** เรียก fn ทุกครั้งที่เสียงพร้อม (ปลดล็อกครั้งแรก + กลับมาจากแท็บซ่อน) */
export function onAudioReady(fn: () => void) {
  readyFns.push(fn)
  if (ac()) fn()
}

function create() {
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return
  ctx = new Ctor()
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -14
  comp.ratio.value = 4
  const master = ctx.createGain()
  master.gain.value = 0.8
  master.connect(comp).connect(ctx.destination)
  musicBus = ctx.createGain()
  musicBus.gain.value = settings.music ? MUSIC_VOL : 0
  musicBus.connect(master)
  sfxBus = ctx.createGain()
  sfxBus.gain.value = settings.sfx ? SFX_VOL : 0
  sfxBus.connect(master)
  // noise สีขาว 2 วิ ใช้ร่วมกันทุกเสียงที่เป็นซ่า (ดิน, น้ำ, ลม, ฝน, เขย่า)
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
  const d = noiseBuf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  ctx.onstatechange = () => {
    if (ctx?.state === 'running') readyFns.forEach((f) => f())
  }
}

function unlock() {
  if (document.hidden) return
  if (!ctx) create()
  if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {})
}

export function initAudio() {
  for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, unlock, { capture: true })
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return
    if (document.hidden) ctx.suspend().catch(() => {})
    else ctx.resume().catch(() => {})
  })
}

function fade(bus: GainNode, to: number) {
  if (!ctx) return
  bus.gain.cancelScheduledValues(ctx.currentTime)
  bus.gain.setTargetAtTime(to, ctx.currentTime, 0.08)
}

export function setMusic(on: boolean) {
  settings.music = on
  try {
    localStorage.setItem(MUSIC_KEY, on ? '1' : '0')
  } catch {
    /* ไม่จำก็ได้ */
  }
  if (musicBus) fade(musicBus, on ? MUSIC_VOL : 0)
}

export function setSfx(on: boolean) {
  settings.sfx = on
  try {
    localStorage.setItem(SFX_KEY, on ? '1' : '0')
  } catch {
    /* ไม่จำก็ได้ */
  }
  if (sfxBus) fade(sfxBus, on ? SFX_VOL : 0)
}

export const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

// ── ชิ้นส่วนสังเคราะห์ ──────────────────────────────────────────────────

export interface ToneOpts {
  f: number // Hz เริ่ม
  f2?: number // Hz ปลาย (ไถลเสียงแบบ exponential)
  t?: number // เริ่มหลังตอนนี้กี่วิ
  dur: number
  vol?: number
  type?: OscillatorType
  attack?: number
  hold?: number // คงระดับไว้กี่วิก่อนเริ่มจาง (เครื่องเป่า) — 0 = จางทันที (เคาะ/ดีด)
  vib?: [rate: number, depth: number] // Hz, ±Hz
  lp?: number // low-pass cutoff
  lp2?: number // cutoff ปลาย (กวาด filter)
}

/** เสียงโทนหนึ่งเสียงพร้อม envelope — ปล่อยทิ้งได้เลย หยุด/ถอดตัวเองเมื่อจบ */
export function tone(c: AudioContext, dst: AudioNode, o: ToneOpts) {
  const t0 = c.currentTime + (o.t ?? 0)
  const end = t0 + o.dur
  const osc = c.createOscillator()
  osc.type = o.type ?? 'sine'
  osc.frequency.setValueAtTime(o.f, t0)
  if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, end)
  const g = c.createGain()
  const vol = o.vol ?? 0.3
  const atk = o.attack ?? 0.005
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(vol, t0 + atk)
  if (o.hold) g.gain.setValueAtTime(vol, t0 + atk + o.hold)
  g.gain.exponentialRampToValueAtTime(0.0001, end)
  let out: AudioNode = g
  if (o.lp) {
    const f = c.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.setValueAtTime(o.lp, t0)
    if (o.lp2) f.frequency.exponentialRampToValueAtTime(o.lp2, end)
    g.connect(f)
    out = f
  }
  out.connect(dst)
  osc.connect(g)
  if (o.vib) {
    const lfo = c.createOscillator()
    const lg = c.createGain()
    lfo.frequency.value = o.vib[0]
    lg.gain.value = o.vib[1]
    lfo.connect(lg).connect(osc.frequency)
    lfo.start(t0)
    lfo.stop(end + 0.02)
  }
  osc.start(t0)
  osc.stop(end + 0.02)
}

export interface NoiseOpts {
  t?: number
  dur: number
  vol?: number
  filter?: BiquadFilterType
  f?: number
  f2?: number
  q?: number
  attack?: number
}

/** เสียงซ่า (noise ผ่าน filter) — ดิน ทราย น้ำกระเซ็น ลมวูบ กล่องกระดาษ */
export function hiss(c: AudioContext, dst: AudioNode, o: NoiseOpts) {
  const t0 = c.currentTime + (o.t ?? 0)
  const end = t0 + o.dur
  const src = c.createBufferSource()
  src.buffer = noiseBuf
  const off = Math.random() * 1.5
  const f = c.createBiquadFilter()
  f.type = o.filter ?? 'bandpass'
  f.frequency.setValueAtTime(o.f ?? 1000, t0)
  if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, end)
  f.Q.value = o.q ?? 1
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(o.vol ?? 0.3, t0 + (o.attack ?? 0.004))
  g.gain.exponentialRampToValueAtTime(0.0001, end)
  src.connect(f).connect(g).connect(dst)
  src.start(t0, off)
  src.stop(end + 0.02)
}
