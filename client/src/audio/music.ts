import { ac, buses, hiss, midiHz, onAudioReady, tone } from './engine'

/**
 * เพลงประกอบ — ตัวต่อเพลงเล็กๆ (sequencer) เล่นเพลงที่เขียนเป็นโน้ตในไฟล์นี้ สังเคราะห์สดทุกโน้ต
 * แต่ละแผนที่มีเพลงของตัวเอง + เพลงหน้าสรุปผล · เหลือ ≤30 วิ เพลงเร่งเร็วขึ้น (แบบ Overcooked)
 *
 * วิธีเขียนทำนอง: 1 ห้อง = 1 string, ช่องละ 1 ตัวโน้ตเขบ็ตหนึ่งชั้น (`slots` ช่อง/ห้อง) คั่นด้วยช่องว่าง
 *   `1`–`7` = ขั้นของบันไดเสียง (scale), ต่อท้าย `'` = สูงขึ้นคู่ 8, `,` = ต่ำลงคู่ 8, `#`/`b` = ครึ่งเสียง
 *   `-` = ลากโน้ตก่อนหน้าต่อ, `.` = เงียบ
 * คอร์ด: ขั้นของบันไดเสียงต่อห้อง ('5M' = บังคับเมเจอร์, '2m' = ไมเนอร์)
 */

type Lead = 'marimba' | 'ocarina' | 'pluck' | 'musicbox'
type Groove = 'bounce' | 'waltz' | 'soft'

interface Song {
  bpm: number
  root: number // MIDI ของขั้นที่ 1 ในช่วงทำนอง
  scale: number[]
  slots: number // ช่องต่อห้อง (8 = 4/4, 6 = 3/4)
  lead: Lead
  groove: Groove
  chords: string[]
  mel: string[]
  sleigh?: boolean // กระดิ่งเลื่อนหิมะแทนลูกแซ็ก
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11]
const MINOR = [0, 2, 3, 5, 7, 8, 10]

const SONGS: Record<string, Song> = {
  // 🌻 ทุ่งหญ้า — มาริมบาเด้งๆ C major
  grass: {
    bpm: 116, root: 72, scale: MAJOR, slots: 8, lead: 'marimba', groove: 'bounce',
    chords: ['1', '5', '6', '4', '1', '5', '4', '5', '4', '1', '5', '6', '4', '1', '5', '1'],
    mel: [
      '1 3 5 3 1\' - 5 .', '7, 2 5 2 7 - 5 .', '6 1\' 3\' 1\' 6 - 5 .', '4 6 1\' 6 5 4 3 2',
      '1 3 5 3 1\' - 5 .', '7, 2 5 7 2\' - 1\' 7', '6 . 4 . 1\' . 6 .', '5 - 4 - 3 - 2 -',
      '6 - 1\' - 6 5 4 .', '5 - 3 - 1 2 3 .', '2 - 5 - 7 6 5 .', '6 - 3 - 6 7 1\' .',
      '1\' - 6 - 4 5 6 .', '5 - 3 - 5 6 5 3', '2 . 5 . 7 . 2\' .', '1\' - - - . . . .',
    ],
  },
  // 🌸 ฤดูใบไม้ผลิ — วอลซ์ 3/4 โอคาริน่า F major
  spring: {
    bpm: 132, root: 77, scale: MAJOR, slots: 6, lead: 'ocarina', groove: 'waltz',
    chords: ['1', '4', '1', '5', '1', '4', '5', '1', '6', '4', '1', '5', '6', '2', '5', '1'],
    mel: [
      '5 - 3 - 1 -', '4 - 6 - 1\' -', '5 - - - 3 4', '5 - 2 - - -',
      '3 - 5 - 1\' -', '1\' - 6 - 4 -', '5 - 7, - 2 -', '1 - - - . .',
      '6 - 1\' - 2\' -', '1\' - 6 - 4 -', '3 - 5 - 1\' -', '7 - - - 5 -',
      '6 - 5 - 6 1\'', '2\' - 1\' - 6 -', '5 - 6 - 7 -', '1\' - - - . .',
    ],
  },
  // 🏜️ ทะเลทราย — ดีดสายแบบโคโตะ A minor (ขั้น 7 ยกครึ่งเสียงให้ได้กลิ่นอายทะเลทราย)
  desert: {
    bpm: 108, root: 69, scale: MINOR, slots: 8, lead: 'pluck', groove: 'bounce',
    chords: ['1', '1', '6', '5M', '1', '4', '5M', '1', '6', '7', '1', '1', '4', '5M', '1', '1'],
    mel: [
      '1 . 3 5 6 . 5 .', '3 . 1 . 7#, . 1 .', '6 . 1\' . 6 5 3 .', '5 - 7# - 5 . . .',
      '1 . 3 5 6 . 5 .', '4 . 6 . 1\' . 6 .', '5 . 7# . 2\' . 7# .', '1\' - - . 5 . 3 .',
      '6 - 1\' - 3\' - 1\' .', '7 - 2\' - 4\' - 2\' .', '1\' - 5 - 3 - 1 .', '3 5 1\' 5 3 . . .',
      '4 . 6 . 1\' 2\' 1\' 6', '7# - 5 - 7#, - 2 .', '1 3 5 1\' 5 3 1 .', '1 - - - . . . .',
    ],
  },
  // ❄️ หิมะ — กล่องดนตรี + กระดิ่งเลื่อน G major
  snow: {
    bpm: 100, root: 79, scale: MAJOR, slots: 8, lead: 'musicbox', groove: 'bounce', sleigh: true,
    chords: ['1', '6', '4', '5', '1', '3', '4', '5', '4', '5', '3', '6', '2', '5', '1', '1'],
    mel: [
      '5 . 3 . 1 . 3 5', '6 . 5 . 3 . . .', '4 . 6 . 1\' . 6 4', '5 - - . 2 3 4 .',
      '5 . 3 . 1 . 3 5', '7 . 5 . 3 . 5 .', '6 . 4 . 1\' . 3\' .', '2\' - - - . . . .',
      '3\' - 1\' - 6 - 1\' .', '2\' - 7 - 5 - 7 .', '7 - 5 - 3 - 5 .', '6 - 3 - 5 6 7 .',
      '6 - 4 - 2 - 4 .', '5 - 7, - 2 - 4 5', '3 5 1\' 5 3 5 1\' .', '1\' - - - . . . .',
    ],
  },
  // 🏆 หน้าสรุปผล — กล่องดนตรีช้าๆ
  results: {
    bpm: 84, root: 84, scale: MAJOR, slots: 8, lead: 'musicbox', groove: 'soft',
    chords: ['1', '4', '1', '5', '1', '4', '5', '1'],
    mel: [
      '5 - 3 - 1 - 3 -', '4 - 6 - 1\' - - -', '5 - 3 - 5 - 1\' -', '7 - 5 - 2 - - -',
      '5 - 3 - 1 - 3 -', '4 - 6 - 1\' - 6 -', '5 - 7, - 2 - 7, -', '1 - - - . . . .',
    ],
  },
}

interface NoteEv {
  slot: number
  len: number
  midi: number
}
interface Parsed {
  song: Song
  bars: NoteEv[][]
  chords: number[][] // MIDI ของคอร์ดแต่ละห้อง (ช่วงกลาง)
}

function degree(song: Song, tok: string): number {
  const m = /^([1-7])([#b]?)([',]*)$/.exec(tok)
  if (!m) return song.root
  const d = Number(m[1]) - 1
  let midi = song.root + song.scale[d]
  if (m[2] === '#') midi += 1
  if (m[2] === 'b') midi -= 1
  for (const ch of m[3]) midi += ch === "'" ? 12 : -12
  return midi
}

function parse(song: Song): Parsed {
  const bars = song.mel.map((bar) => {
    const toks = bar.trim().split(/\s+/)
    const out: NoteEv[] = []
    toks.forEach((t, i) => {
      if (t === '-' && out.length) out[out.length - 1].len += 1
      else if (t !== '.' && t !== '-') out.push({ slot: i, len: 1, midi: degree(song, t) })
    })
    return out
  })
  const chords = song.chords.map((spec) => {
    const d = Number(spec[0]) - 1
    const base = song.root - 12 + song.scale[d]
    if (spec[1] === 'M') return [base, base + 4, base + 7]
    if (spec[1] === 'm') return [base, base + 3, base + 7]
    const at = (k: number) => song.root - 12 + song.scale[(d + k) % 7] + (d + k >= 7 ? 12 : 0)
    return [at(0), at(2), at(4)]
  })
  return { song, bars, chords }
}

// ── เครื่องดนตรี ────────────────────────────────────────────────────────

function lead(c: AudioContext, d: AudioNode, kind: Lead, f: number, t: number, len: number) {
  switch (kind) {
    case 'marimba':
      tone(c, d, { t, f, dur: 0.45, vol: 0.3 })
      tone(c, d, { t, f: f * 4, dur: 0.06, vol: 0.06 })
      break
    case 'ocarina':
      tone(c, d, { t, f, dur: Math.max(0.2, len * 0.95), vol: 0.2, attack: 0.03, hold: len * 0.6, vib: [5.5, f * 0.008] })
      tone(c, d, { t, f: f * 2, dur: Math.max(0.2, len * 0.8), vol: 0.025, attack: 0.03 })
      break
    case 'pluck':
      tone(c, d, { t, f, dur: 0.5, vol: 0.24, type: 'triangle', lp: 3500, lp2: 700 })
      tone(c, d, { t, f: f * 2, dur: 0.12, vol: 0.05, type: 'sawtooth', lp: 3000 })
      break
    case 'musicbox':
      tone(c, d, { t, f, dur: 1.1, vol: 0.2 })
      tone(c, d, { t, f: f * 3, dur: 0.3, vol: 0.05 })
      tone(c, d, { t, f: f * 5.4, dur: 0.08, vol: 0.02 })
      break
  }
}

function bass(c: AudioContext, d: AudioNode, midi: number, t: number, vol = 0.34) {
  tone(c, d, { t, f: midiHz(midi), dur: 0.28, vol, type: 'triangle' })
}
function strum(c: AudioContext, d: AudioNode, chord: number[], t: number, vol = 0.05) {
  chord.forEach((m, i) => tone(c, d, { t: t + i * 0.012, f: midiHz(m + 12), dur: 0.2, vol, type: 'triangle', lp: 2500 }))
}
function kick(c: AudioContext, d: AudioNode, t: number) {
  tone(c, d, { t, f: 140, f2: 50, dur: 0.14, vol: 0.4 })
}
function snap(c: AudioContext, d: AudioNode, t: number) {
  hiss(c, d, { t, dur: 0.06, vol: 0.12, f: 2200, q: 1.2 })
}
function shaker(c: AudioContext, d: AudioNode, t: number, vol = 0.035) {
  hiss(c, d, { t, dur: 0.04, vol, filter: 'highpass', f: 7000 })
}
function sleigh(c: AudioContext, d: AudioNode, t: number, vol = 0.03) {
  hiss(c, d, { t, dur: 0.07, vol, filter: 'bandpass', f: 9000, q: 3 })
  tone(c, d, { t, f: 5200 + Math.random() * 300, dur: 0.05, vol: vol * 0.5 })
}

// ── ตัวต่อเพลง ──────────────────────────────────────────────────────────

const LOOKAHEAD = 0.15

class MusicPlayer {
  private cur: Parsed | null = null
  private want: string | null = null
  private step = 0
  private nextTime = 0
  private hurry = false

  constructor() {
    setInterval(() => this.pump(), 30)
    onAudioReady(() => {
      const c = ac()
      if (c) this.nextTime = Math.max(this.nextTime, c.currentTime + 0.05)
    })
  }

  /** เปลี่ยนเพลง (ชื่อธีมแผนที่ หรือ 'results') — เพลงเดิมอยู่แล้วไม่เริ่มใหม่ */
  play(name: string) {
    const key = SONGS[name] ? name : 'grass'
    if (this.want === key) return
    this.want = key
    this.cur = parse(SONGS[key])
    this.step = 0
    this.hurry = false
    const c = ac()
    // เว้นจังหวะนิดนึงให้เสียงเริ่มรอบ/จบรอบดังก่อน
    if (c) this.nextTime = c.currentTime + (key === 'results' ? 2.6 : 1.9)
  }

  setHurry(on: boolean) {
    this.hurry = on
  }

  private pump() {
    const c = ac()
    if (!c || !this.cur) return
    if (this.nextTime < c.currentTime - 0.2) this.nextTime = c.currentTime + 0.05 // กลับมาจากแท็บซ่อน
    const { song } = this.cur
    const bpm = song.bpm * (this.hurry ? 1.2 : 1)
    const slotSec = 60 / bpm / 2
    while (this.nextTime < c.currentTime + LOOKAHEAD) {
      this.playStep(c, this.step, this.nextTime - c.currentTime, slotSec)
      this.nextTime += slotSec
      this.step++
    }
  }

  private playStep(c: AudioContext, step: number, t: number, slotSec: number) {
    if (t < 0) return
    const { song, bars, chords } = this.cur!
    const d = buses().music
    const bar = Math.floor(step / song.slots) % bars.length
    const s = step % song.slots
    for (const n of bars[bar]) if (n.slot === s) lead(c, d, song.lead, midiHz(n.midi), t, n.len * slotSec)
    const chord = chords[bar]
    const root = chord[0] - 12
    if (song.groove === 'waltz') {
      if (s === 0) bass(c, d, root, t)
      if (s === 2 || s === 4) strum(c, d, chord, t, 0.045)
      if (s === 0) kick(c, d, t)
      if (s % 2 === 1) shaker(c, d, t, 0.025)
    } else if (song.groove === 'bounce') {
      if (s === 0) bass(c, d, root, t)
      if (s === 3) bass(c, d, root + 12, t, 0.18)
      if (s === 4) bass(c, d, chord[2] - 12, t)
      if (s === 7) bass(c, d, chord[1] - 12, t, 0.16)
      if (s === 2 || s === 6) strum(c, d, chord, t)
      if (s === 0 || s === 4) kick(c, d, t)
      if (s === 2 || s === 6) snap(c, d, t)
      if (song.sleigh) sleigh(c, d, t, s % 2 ? 0.02 : 0.035)
      else if (s % 2 === 1) shaker(c, d, t)
      // ทุก 4 ห้อง: ระยิบระยับเล็กๆ ปิดท้ายวลี
      if (bar % 4 === 3 && s === 4) chord.forEach((m, i) => tone(c, d, { t: t + i * 0.07, f: midiHz(m + 24), dur: 0.4, vol: 0.04 }))
    } else {
      if (s === 0) bass(c, d, root, t, 0.22)
      if (s === 4) strum(c, d, chord, t, 0.035)
    }
    if (this.hurry && s % 2 === 0) tone(c, d, { t, f: s % 4 ? 1800 : 2400, dur: 0.03, vol: 0.03, type: 'triangle' }) // ติ๊กๆ ให้รู้ว่าเร่ง
  }
}

export const music = new MusicPlayer()
