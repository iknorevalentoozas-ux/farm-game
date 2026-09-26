import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { Theme } from '../level/collision'

/**
 * โมเดลทั้งหมดสร้างจากรูปทรงพื้นฐาน (ไม่มีไฟล์ภาพ/โมเดล) — หน่วย: 1 = 1 ช่อง (64px), แกน y ชี้ขึ้น
 * สไตล์ "น่ารัก": วัสดุ Toon (แสงเป็นขั้นๆ แบบการ์ตูน) + ขอบมน (RoundedBox/ทรงกลมละเอียด) + สีพาสเทล
 * ตัวละคร/สัตว์/ผลผลิตมีหน้า (ตาดำมีจุดวาว + แก้มชมพู) ให้ดูมีชีวิต
 * วัสดุถูกแคชต่อสี (mat()) — ฉากนิ่งทั้งหมดรวม geometry ตามวัสดุทีหลัง (Renderer.mergeStatic) จึงเหลือ draw call น้อย
 */

let gradient: THREE.DataTexture | null = null
/** แสง 3 ขั้น (เงา / กลาง / สว่าง) — หัวใจของลุคการ์ตูน */
function toonGradient() {
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array([120, 190, 255]), 3, 1, THREE.RedFormat)
    gradient.minFilter = THREE.NearestFilter
    gradient.magFilter = THREE.NearestFilter
    gradient.generateMipmaps = false
    gradient.needsUpdate = true
  }
  return gradient
}

const matCache = new Map<string, THREE.Material>()
export function mat(color: string, opts: { emissive?: string; transparent?: boolean; opacity?: number } = {}) {
  const key = `${color}|${opts.emissive || ''}|${opts.opacity ?? 1}`
  let m = matCache.get(key)
  if (!m) {
    m = new THREE.MeshToonMaterial({
      color,
      gradientMap: toonGradient(),
      ...(opts.emissive ? { emissive: new THREE.Color(opts.emissive) } : {}), // ส่ง undefined แล้ว three เตือนทุกวัสดุ
      transparent: !!opts.transparent,
      opacity: opts.opacity ?? 1,
    })
    matCache.set(key, m)
  }
  return m
}

type V3 = [number, number, number]
function mesh(geo: THREE.BufferGeometry, color: string | THREE.Material, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]) {
  const m = new THREE.Mesh(geo, typeof color === 'string' ? mat(color) : color)
  m.position.set(...pos)
  m.rotation.set(...rot)
  m.scale.set(...scale)
  m.castShadow = true
  m.receiveShadow = true
  return m
}
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)
const rbox = (w: number, h: number, d: number, r = 0.06) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, Math.min(w, h, d) * 0.45))
const cyl = (rt: number, rb: number, h: number, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg)
const cone = (r: number, h: number, seg = 10) => new THREE.ConeGeometry(r, h, seg)
const ball = (r: number, detail = 2) => new THREE.IcosahedronGeometry(r, detail)
const sphere = (r: number, w = 16, h = 12) => new THREE.SphereGeometry(r, w, h)
const dome = (r: number) => new THREE.SphereGeometry(r, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2)
const capsule = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 4, 12)
const group = (...children: THREE.Object3D[]) => {
  const g = new THREE.Group()
  children.forEach((c) => g.add(c))
  return g
}

export const PALETTE = {
  grass: ['#92d46c', '#88cc63'],
  grassDark: '#6fb551',
  spring: ['#a9de82', '#9fd778'],
  springDark: '#86c465',
  desert: ['#f4d9a4', '#eed09a'],
  desertDark: '#d9b579',
  snow: ['#f6fafd', '#ebf3f9'],
  snowDark: '#d3e2ee',
  wood: '#c98e58',
  woodDark: '#9c6a3c',
  woodLight: '#e8b47c',
  cream: '#fff6e4',
  soilRaw: '#b88458',
  soilTilled: '#8f5d38',
  soilWet: '#62391f',
  water: '#6cc9f2',
  cardboard: '#e2b57a',
  eye: '#2b2230',
  blush: '#ff9fb5',
}

export const CROP_COLOR: Record<string, string> = {
  carrot: '#ff9a3c',
  lettuce: '#9ee07a',
  tomato: '#ff5a4e',
  corn: '#ffd84f',
  strawberry: '#ff4f6d',
  pumpkin: '#ffa040',
  egg: '#fff4e0',
  milk: '#ffffff',
}

export const PLAYER_COLORS = ['#ff6b6b', '#4d96ff', '#ffc93c', '#6bcb77', '#b983ff', '#ff8fc7', '#3ed1d1', '#ff9f43']

/** หน้าน่ารัก: ตาดำ 2 ข้างมีจุดวาว + แก้มชมพู — วางที่ระยะ z หน้าวัตถุ (หันไปทาง +z) */
function face(size: number, y: number, z: number, blush = true) {
  const g = new THREE.Group()
  const ex = size * 0.42
  for (const s of [-1, 1]) {
    g.add(mesh(sphere(size * 0.16, 10, 8), PALETTE.eye, [s * ex, y, z], [0, 0, 0], [1, 1.25, 0.6]))
    g.add(mesh(sphere(size * 0.06, 6, 4), '#ffffff', [s * ex + size * 0.05, y + size * 0.07, z + size * 0.08]))
    if (blush) g.add(mesh(sphere(size * 0.14, 10, 6), mat(PALETTE.blush, { opacity: 0.85, transparent: true }), [s * ex * 1.55, y - size * 0.2, z - size * 0.04], [0, 0, 0], [1, 0.6, 0.35]))
  }
  g.traverse((o) => (o.castShadow = false))
  return g
}

// ── ฉาก ─────────────────────────────────────────────────────────────────

export function groundTile(theme: Theme, seed: number, checker = 0) {
  const cols = PALETTE[theme]
  return mesh(box(1, 0.2, 1), cols[checker % cols.length], [0, -0.1, 0])
}

const rnd = (seed: number) => (n: number) => ((Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1

function flower(x: number, z: number, petal: string, h = 0.14) {
  const g = group(mesh(cyl(0.012, 0.012, h, 5), '#4f9a3a', [x, h / 2, z]))
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    g.add(mesh(sphere(0.035, 8, 6), petal, [x + Math.cos(a) * 0.04, h + 0.01, z + Math.sin(a) * 0.04], [0, 0, 0], [1, 0.5, 1]))
  }
  g.add(mesh(sphere(0.028, 8, 6), '#ffd84a', [x, h + 0.02, z]))
  return g
}

function mushroom(x: number, z: number) {
  return group(
    mesh(cyl(0.03, 0.035, 0.08, 8), '#fff3dc', [x, 0.04, z]),
    mesh(sphere(0.07, 12, 8, ), '#ff5f5f', [x, 0.09, z], [0, 0, 0], [1, 0.65, 1]),
    mesh(sphere(0.014, 6, 4), '#ffffff', [x + 0.03, 0.125, z + 0.02]),
    mesh(sphere(0.012, 6, 4), '#ffffff', [x - 0.025, 0.13, z - 0.015]),
  )
}

/** ของตกแต่งบนพื้นเปล่า — สุ่มจาก seed ให้แต่ละช่องไม่เหมือนกัน */
export function decor(theme: Theme, seed: number): THREE.Object3D | null {
  const r = rnd(seed)
  if (r(1) > 0.42) return null
  const x = r(2) * 0.7 - 0.35
  const z = r(3) * 0.7 - 0.35
  if (theme === 'grass' || theme === 'spring') {
    const k = r(4)
    if (k < 0.4) {
      const pal = theme === 'spring' ? ['#ffc4dd', '#ffffff', '#ffe27a', '#ff9ec7'] : ['#ffffff', '#ffd84a', '#ff9fc2', '#c3a6ff', '#8fd3ff']
      const g = flower(x, z, pal[Math.floor(r(5) * pal.length)])
      if (r(9) < 0.5) g.add(flower(x + 0.12, z + 0.06, pal[Math.floor(r(10) * pal.length)], 0.1))
      return g
    }
    if (k < 0.5) return mushroom(x, z)
    if (theme === 'spring' && k < 0.7) {
      // กลีบซากุระร่วงบนพื้น
      const g = group()
      for (let i = 0; i < 4; i++) g.add(mesh(sphere(0.035, 8, 4), '#ffc4dd', [x + r(20 + i) * 0.3 - 0.15, 0.01, z + r(30 + i) * 0.3 - 0.15], [0, r(40 + i) * 3, 0], [1, 0.2, 0.6]))
      return g
    }
    const dark = theme === 'spring' ? PALETTE.springDark : PALETTE.grassDark
    return group(
      mesh(cone(0.035, 0.18, 5), dark, [x, 0.09, z], [0, 0, 0.25]),
      mesh(cone(0.035, 0.14, 5), dark, [x + 0.05, 0.07, z + 0.02], [0, 0, -0.3]),
      mesh(cone(0.03, 0.12, 5), dark, [x - 0.04, 0.06, z - 0.02], [0.2, 0, 0.1]),
    )
  }
  if (theme === 'desert') {
    if (r(4) < 0.25) return group(mesh(capsule(0.05, 0.1), '#6fbf5a', [x, 0.1, z]), mesh(sphere(0.025, 8, 6), '#ff8fc0', [x, 0.2, z]))
    return mesh(ball(0.06 + r(6) * 0.05, 1), '#d9b27a', [x, 0.03, z], [r(7), r(8), 0], [1, 0.6, 1])
  }
  if (r(4) < 0.06) return snowman(x, z)
  return mesh(sphere(0.1 + r(6) * 0.06, 12, 8), '#ffffff', [x, 0.0, z], [0, 0, 0], [1.3, 0.5, 1])
}

function snowman(x: number, z: number) {
  const g = group(
    mesh(sphere(0.13), '#ffffff', [x, 0.12, z]),
    mesh(sphere(0.09), '#ffffff', [x, 0.3, z]),
    mesh(cone(0.02, 0.08, 6), '#ff8a3c', [x, 0.3, z + 0.1], [Math.PI / 2, 0, 0]),
    mesh(cyl(0.07, 0.07, 0.03, 12), '#ff6b6b', [x, 0.36, z]),
  )
  g.add(face(0.12, 0.32, z + 0.086, true).translateX(x))
  return g
}

/** รั้วไม้ขาวยอดมน (ช่องละ 1 เสา + ราวขวาง 2 ทิศ) */
export function fence() {
  const post = '#fff6e8'
  const rail = '#f3e2c8'
  return group(
    mesh(rbox(0.14, 0.62, 0.14, 0.04), post, [0, 0.31, 0]),
    mesh(sphere(0.085, 10, 8), post, [0, 0.64, 0], [0, 0, 0], [1, 0.8, 1]),
    mesh(rbox(1, 0.09, 0.06, 0.03), rail, [0, 0.46, 0]),
    mesh(rbox(0.06, 0.09, 1, 0.03), rail, [0, 0.46, 0]),
    mesh(rbox(1, 0.09, 0.06, 0.03), rail, [0, 0.24, 0]),
    mesh(rbox(0.06, 0.09, 1, 0.03), rail, [0, 0.24, 0]),
  )
}

export function tree(theme: Theme) {
  if (theme === 'desert') {
    return group(
      mesh(capsule(0.17, 0.75), '#6fbf5a', [0, 0.55, 0]),
      mesh(capsule(0.09, 0.2), '#6fbf5a', [0.26, 0.55, 0], [0, 0, -Math.PI / 2]),
      mesh(capsule(0.09, 0.22), '#6fbf5a', [0.36, 0.75, 0]),
      mesh(capsule(0.08, 0.18), '#6fbf5a', [-0.24, 0.7, 0], [0, 0, Math.PI / 2]),
      mesh(capsule(0.08, 0.16), '#6fbf5a', [-0.33, 0.86, 0]),
      mesh(sphere(0.07), '#ff8fc0', [0, 1.1, 0]),
      mesh(sphere(0.05), '#ffd84a', [0.36, 0.98, 0]),
    )
  }
  if (theme === 'snow') {
    return group(
      mesh(cyl(0.08, 0.1, 0.35, 8), '#8a5a33', [0, 0.18, 0]),
      mesh(cone(0.5, 0.6, 10), '#3f9a72', [0, 0.6, 0]),
      mesh(cone(0.44, 0.1, 10), '#ffffff', [0, 0.88, 0]),
      mesh(cone(0.38, 0.5, 10), '#46a67b', [0, 0.98, 0]),
      mesh(cone(0.32, 0.08, 10), '#ffffff', [0, 1.2, 0]),
      mesh(cone(0.25, 0.42, 10), '#4fb385', [0, 1.3, 0]),
      mesh(cone(0.12, 0.14, 10), '#ffffff', [0, 1.5, 0]),
      mesh(ball(0.06, 0), '#ffd84a', [0, 1.6, 0]),
    )
  }
  const leaf = theme === 'spring' ? ['#ffb3d1', '#ffc6dc', '#ff9fc4'] : ['#5fc25a', '#6fd06a', '#56b551']
  const fruit = theme === 'spring' ? '#ffffff' : '#ff5a5a'
  const g = group(
    mesh(cyl(0.09, 0.14, 0.6, 8), '#8a5a33', [0, 0.3, 0]),
    mesh(sphere(0.42), leaf[0], [0, 0.88, 0]),
    mesh(sphere(0.3), leaf[1], [0.25, 1.1, 0.08]),
    mesh(sphere(0.3), leaf[2], [-0.24, 1.05, -0.06]),
    mesh(sphere(0.26), leaf[1], [0.02, 1.25, -0.1]),
  )
  for (const [x, y, z] of [[0.3, 0.85, 0.28], [-0.2, 0.95, 0.33], [0.1, 1.2, 0.3]] as V3[]) g.add(mesh(sphere(0.06, 8, 6), fruit, [x, y, z]))
  return g
}

export function counter(rack: boolean) {
  const g = group(
    mesh(rbox(0.92, 0.5, 0.92, 0.08), rack ? PALETTE.woodDark : PALETTE.wood, [0, 0.25, 0]),
    mesh(rbox(0.98, 0.09, 0.98, 0.04), rack ? PALETTE.wood : PALETTE.woodLight, [0, 0.54, 0]),
  )
  if (rack) {
    g.add(mesh(rbox(0.9, 0.55, 0.07, 0.03), '#b7825a', [0, 0.85, -0.42]))
    for (const x of [-0.25, 0, 0.25]) g.add(mesh(sphere(0.03, 6, 4), '#e8d7bf', [x, 0.95, -0.37]))
  } else {
    g.add(mesh(rbox(0.8, 0.02, 0.8, 0.01), '#f7e6c8', [0, 0.59, 0])) // ผ้าปูโต๊ะ
  }
  return g
}

export function packStation() {
  const g = group(
    mesh(rbox(0.92, 0.5, 0.92, 0.08), '#a8744a', [0, 0.25, 0]),
    mesh(rbox(0.98, 0.09, 0.98, 0.04), '#d9a26b', [0, 0.54, 0]),
    mesh(rbox(0.34, 0.26, 0.34, 0.03), PALETTE.cardboard, [0.28, 0.72, -0.3]),
    mesh(rbox(0.28, 0.22, 0.28, 0.03), '#d9a766', [0.28, 0.96, -0.3]),
    mesh(new THREE.TorusGeometry(0.07, 0.03, 8, 14), '#ff9fb5', [-0.3, 0.62, -0.3], [Math.PI / 2, 0, 0]),
  )
  g.add(mesh(sphere(0.05, 8, 6), '#ff6b6b', [0.28, 1.1, -0.3], [0, 0, 0], [1.4, 0.6, 1])) // โบว์
  return g
}

export function seedBox(crops: string[]) {
  const g = group(mesh(rbox(0.9, 0.55, 0.9, 0.08), '#b57f48', [0, 0.28, 0]), mesh(rbox(0.96, 0.07, 0.96, 0.03), '#dfa56a', [0, 0.58, 0]))
  crops.slice(0, 3).forEach((c, i) => {
    const x = -0.28 + i * 0.28
    g.add(mesh(sphere(0.13), '#efd9b0', [x, 0.72, 0], [0, 0, 0], [1, 1.2, 0.85]))
    g.add(mesh(rbox(0.18, 0.1, 0.05, 0.02), CROP_COLOR[c] || '#888', [x, 0.72, 0.11]))
  })
  return g
}

export function trashBin() {
  return group(
    mesh(cyl(0.3, 0.26, 0.66, 16), '#7fc493', [0, 0.33, 0]),
    mesh(cyl(0.34, 0.34, 0.1, 16), '#5faa75', [0, 0.7, 0]),
    mesh(capsule(0.035, 0.12), '#4d8f60', [0, 0.79, 0], [0, 0, Math.PI / 2]),
    mesh(sphere(0.06, 8, 6), '#ffffff', [0, 0.35, 0.29], [0, 0, 0], [1, 1, 0.3]),
  )
}

export function pond(seed = 0) {
  const water = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 1), mat(PALETTE.water, { emissive: '#1f6f99', transparent: true, opacity: 0.88 }))
  water.position.y = -0.08
  water.receiveShadow = true
  const g = group(water)
  const r = rnd(seed + 7)
  if (r(1) < 0.6) {
    const pad = mesh(cyl(0.14, 0.14, 0.015, 12), '#6cc25a', [r(2) * 0.5 - 0.25, -0.02, r(3) * 0.5 - 0.25])
    g.add(pad)
    if (r(4) < 0.5) g.add(mesh(sphere(0.04, 8, 6), '#ffb3d1', [pad.position.x, 0.02, pad.position.z]))
  }
  return g
}

/** เป็ดยางลอยน้ำ — World ขยับให้ลอยไปมา */
export function duck() {
  const g = group(
    mesh(sphere(0.12), '#ffd93b', [0, 0.05, 0], [0, 0, 0], [1, 0.8, 1.2]),
    mesh(sphere(0.08), '#ffd93b', [0, 0.17, 0.08]),
    mesh(cone(0.035, 0.08, 8), '#ff9a3c', [0, 0.16, 0.18], [Math.PI / 2, 0, 0]),
  )
  g.add(face(0.08, 0.19, 0.155, true))
  return g
}

export function shop() {
  const g = group(
    mesh(rbox(0.95, 0.6, 0.8, 0.06), PALETTE.cream, [0, 0.3, 0.05]),
    mesh(rbox(1.0, 0.08, 0.85, 0.03), PALETTE.woodLight, [0, 0.62, 0.05]),
  )
  for (const [x, z] of [[-0.44, 0.4], [0.44, 0.4], [-0.44, -0.3], [0.44, -0.3]]) g.add(mesh(cyl(0.04, 0.04, 1.0, 8), PALETTE.woodDark, [x, 1.0, z]))
  for (let i = 0; i < 6; i++) {
    g.add(mesh(rbox(0.18, 0.06, 0.95, 0.02), i % 2 ? '#ffffff' : '#ff8fa8', [-0.45 + i * 0.18, 1.52, 0.05], [0.25, 0, 0]))
    g.add(mesh(sphere(0.09, 10, 6), i % 2 ? '#ffffff' : '#ff8fa8', [-0.45 + i * 0.18, 1.5, 0.52], [0, 0, 0], [1, 0.6, 0.5])) // ชายระบาย
  }
  g.add(mesh(sphere(0.1), '#ffc93c', [0.2, 0.75, 0.2]), mesh(sphere(0.08), '#ff5a4e', [-0.15, 0.72, 0.25]), mesh(sphere(0.07), '#9ee07a', [0.02, 0.72, 0.3]))
  return g
}

export function truck() {
  const g = group(
    mesh(rbox(1.1, 0.85, 1.7, 0.12), '#fffaf0', [0, 0.75, -0.25]),
    mesh(rbox(1.0, 0.8, 0.72, 0.16), '#6fb7ff', [0, 0.62, 0.95]),
    mesh(rbox(0.85, 0.28, 0.05, 0.03), '#d8f1ff', [0, 0.82, 1.31]),
    mesh(rbox(1.12, 0.14, 2.45, 0.05), '#5a6272', [0, 0.26, 0.1]),
    mesh(rbox(0.7, 0.18, 0.02, 0.02), '#ff8fa8', [0, 0.95, 0.59]),
  )
  // ไฟหน้าเป็น "ตา" + แก้ม — รถขนของก็ต้องน่ารัก
  for (const s of [-1, 1]) {
    g.add(mesh(sphere(0.09, 12, 8), '#ffffff', [s * 0.3, 0.45, 1.3], [0, 0, 0], [1, 1, 0.4]))
    g.add(mesh(sphere(0.05, 10, 6), PALETTE.eye, [s * 0.3, 0.45, 1.34], [0, 0, 0], [1, 1.2, 0.4]))
    g.add(mesh(sphere(0.06, 10, 6), mat(PALETTE.blush, { transparent: true, opacity: 0.8 }), [s * 0.42, 0.33, 1.31], [0, 0, 0], [1, 0.6, 0.3]))
  }
  for (const [x, z] of [[-0.55, 0.9], [0.55, 0.9], [-0.55, -0.6], [0.55, -0.6]]) {
    g.add(mesh(cyl(0.22, 0.22, 0.16, 16), '#3b3f4a', [x, 0.22, z], [0, 0, Math.PI / 2]))
    g.add(mesh(cyl(0.1, 0.1, 0.17, 12), '#d9dde6', [x, 0.22, z], [0, 0, Math.PI / 2]))
  }
  return g
}

// ── แปลง + พืช ─────────────────────────────────────────────────────────

export function soil(state: 'raw' | 'tilled' | 'wet') {
  const color = state === 'raw' ? PALETTE.soilRaw : state === 'tilled' ? PALETTE.soilTilled : PALETTE.soilWet
  const g = group(mesh(rbox(0.9, 0.12, 0.9, 0.05), color, [0, 0.02, 0]))
  if (state === 'raw') {
    g.add(mesh(ball(0.04, 0), '#a8a29a', [0.2, 0.09, -0.15]), mesh(ball(0.03, 0), '#bdb7ae', [-0.25, 0.09, 0.2]))
  } else {
    for (let i = -1; i <= 1; i++) g.add(mesh(capsule(0.06, 0.66), color, [0, 0.1, i * 0.27], [0, 0, Math.PI / 2], [1, 0.6, 1]))
    if (state === 'wet') g.add(mesh(sphere(0.07, 10, 6), mat('#8fd6ff', { transparent: true, opacity: 0.6 }), [0.25, 0.1, 0.12], [0, 0, 0], [1.4, 0.15, 1]))
  }
  return g
}

/** พืช stage 0..2 = กำลังโต, 3 = พร้อมเก็บ */
export function crop(id: string, stage: number) {
  const s = [0.35, 0.6, 0.85, 1][stage]
  const leaf = '#5fb548'
  if (stage === 0) {
    return group(
      mesh(sphere(0.06, 8, 6), leaf, [-0.05, 0.2, 0], [0, 0, 0.6], [1, 0.4, 0.7]),
      mesh(sphere(0.06, 8, 6), leaf, [0.05, 0.2, 0], [0, 0, -0.6], [1, 0.4, 0.7]),
      mesh(cyl(0.012, 0.012, 0.12, 5), leaf, [0, 0.12, 0]),
    )
  }
  switch (id) {
    case 'carrot': {
      const g = group()
      for (let i = 0; i < 4; i++) g.add(mesh(sphere(0.07, 8, 6), leaf, [Math.cos(i * 1.6) * 0.06, 0.12 + 0.2 * s, Math.sin(i * 1.6) * 0.06], [Math.sin(i) * 0.4, 0, Math.cos(i) * 0.4], [0.5, 2.2 * s, 0.5]))
      if (stage === 3) g.add(mesh(cone(0.11, 0.22, 12), CROP_COLOR.carrot, [0, 0.12, 0], [Math.PI, 0, 0]))
      return g
    }
    case 'lettuce': {
      const g = group()
      const n = stage === 3 ? 7 : 4
      for (let i = 0; i < n; i++) g.add(mesh(sphere(0.15 * s, 10, 8), i % 2 ? '#a6e37f' : '#7fcc5a', [Math.cos(i) * 0.1 * s, 0.14 + 0.06 * s, Math.sin(i) * 0.1 * s], [0, i, 0], [1, 0.7, 1]))
      if (stage === 3) g.add(mesh(sphere(0.19), '#c6f09f', [0, 0.27, 0], [0, 0, 0], [1, 0.8, 1]))
      return g
    }
    case 'tomato': {
      const g = group(mesh(cyl(0.025, 0.03, 0.6 * s, 6), '#4d9a3a', [0, 0.1 + 0.3 * s, 0]))
      for (let i = 0; i < 3; i++) g.add(mesh(sphere(0.12 * s, 10, 8), leaf, [Math.cos(i * 2.1) * 0.12, 0.2 + 0.25 * s, Math.sin(i * 2.1) * 0.12]))
      if (stage === 3) for (let i = 0; i < 4; i++) g.add(mesh(sphere(0.085), CROP_COLOR.tomato, [Math.cos(i * 1.6) * 0.16, 0.42 + (i % 2) * 0.12, Math.sin(i * 1.6) * 0.16]))
      return g
    }
    case 'corn': {
      const g = group(mesh(cyl(0.035, 0.045, 1.0 * s, 6), '#6aad44', [0, 0.1 + 0.5 * s, 0]))
      for (let i = 0; i < 3; i++) g.add(mesh(sphere(0.1, 8, 6), '#79c053', [0, 0.25 + i * 0.25 * s, 0.12], [0.6, i * 2.1, 0], [0.3, 0.12, 2 * s]))
      if (stage === 3) g.add(mesh(capsule(0.07, 0.18), CROP_COLOR.corn, [0.08, 0.75, 0], [0, 0, -0.3]), mesh(cone(0.08, 0.12, 8), '#8fcf60', [0.12, 0.93, 0], [0, 0, -0.3]))
      return g
    }
    case 'strawberry': {
      const g = group()
      for (let i = 0; i < 5; i++) g.add(mesh(sphere(0.1 * s, 10, 6), leaf, [Math.cos(i * 1.3) * 0.15, 0.12, Math.sin(i * 1.3) * 0.15], [0, 0, 0], [1, 0.6, 1]))
      if (stage === 3) for (let i = 0; i < 4; i++) g.add(mesh(sphere(0.07, 10, 8), CROP_COLOR.strawberry, [Math.cos(i * 1.6 + 0.5) * 0.2, 0.14, Math.sin(i * 1.6 + 0.5) * 0.2], [0, 0, 0], [1, 1.25, 1]))
      return g
    }
    case 'pumpkin': {
      const g = group()
      for (let i = 0; i < 3; i++) g.add(mesh(sphere(0.13 * s, 10, 6), leaf, [Math.cos(i * 2) * 0.22, 0.12, Math.sin(i * 2) * 0.22], [0, 0, 0], [1, 0.5, 1]))
      if (stage >= 2) {
        const r = stage === 3 ? 0.28 : 0.12
        g.add(pumpkinBody(r, 0.08 + r * 0.7))
        g.add(mesh(cyl(0.03, 0.04, 0.1, 6), '#6b8f2e', [0, 0.1 + r * 1.35, 0]))
      }
      return g
    }
  }
  return group(mesh(sphere(0.15 * s), leaf, [0, 0.2, 0]))
}

function pumpkinBody(r: number, y: number) {
  const g = group()
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    g.add(mesh(sphere(r * 0.62, 12, 10), CROP_COLOR.pumpkin, [Math.cos(a) * r * 0.42, y, Math.sin(a) * r * 0.42], [0, 0, 0], [1, 1.05, 1]))
  }
  return g
}

// ── ของที่ถือ/วางได้ ────────────────────────────────────────────────────

/** ผลผลิต 1 ชิ้นสำหรับถือ/วาง (เล็กกว่าที่อยู่บนแปลง) — มีหน้ายิ้ม */
function produce(id: string) {
  switch (id) {
    case 'carrot':
      return group(mesh(cone(0.1, 0.3, 12), CROP_COLOR.carrot, [0, 0.15, 0], [Math.PI, 0, 0]), mesh(sphere(0.05, 8, 6), '#5fb548', [0, 0.34, 0], [0, 0, 0], [0.6, 1.6, 0.6]), face(0.1, 0.24, 0.085))
    case 'lettuce':
      return group(mesh(sphere(0.15), '#9ee07a', [0, 0.14, 0], [0, 0, 0], [1, 0.85, 1]), mesh(sphere(0.1), '#c6f09f', [0, 0.23, 0]), face(0.1, 0.15, 0.148))
    case 'tomato':
      return group(mesh(sphere(0.14), CROP_COLOR.tomato, [0, 0.14, 0], [0, 0, 0], [1, 0.9, 1]), mesh(cone(0.06, 0.05, 6), '#4d9a3a', [0, 0.28, 0]), face(0.11, 0.15, 0.138))
    case 'corn':
      return group(mesh(capsule(0.08, 0.2), CROP_COLOR.corn, [0, 0.12, 0], [0, 0, Math.PI / 2]), mesh(cone(0.07, 0.16, 8), '#8fcf60', [0.21, 0.12, 0], [0, 0, -Math.PI / 2]), face(0.08, 0.13, 0.08))
    case 'strawberry':
      return group(mesh(sphere(0.12, 14, 10), CROP_COLOR.strawberry, [0, 0.12, 0], [0, 0, 0], [1, 1.15, 1]), mesh(cone(0.08, 0.04, 6), '#4d9a3a', [0, 0.26, 0]), face(0.1, 0.13, 0.12))
    case 'pumpkin':
      return group(pumpkinBody(0.17, 0.13), mesh(cyl(0.02, 0.03, 0.08, 6), '#6b8f2e', [0, 0.27, 0]), face(0.12, 0.15, 0.172))
    case 'egg':
      return group(mesh(sphere(0.11, 14, 12), CROP_COLOR.egg, [0, 0.13, 0], [0, 0, 0], [1, 1.3, 1]), face(0.09, 0.14, 0.107))
    case 'milk':
      return group(
        mesh(cyl(0.09, 0.1, 0.24, 14), '#ffffff', [0, 0.12, 0]),
        mesh(cyl(0.05, 0.08, 0.06, 12), '#ffffff', [0, 0.27, 0]),
        mesh(cyl(0.055, 0.055, 0.04, 12), '#6fb7ff', [0, 0.32, 0]),
        mesh(cyl(0.092, 0.102, 0.08, 14), '#6fb7ff', [0, 0.1, 0]),
        face(0.08, 0.17, 0.097),
      )
  }
  return mesh(sphere(0.12), '#999', [0, 0.12, 0])
}

function sack(label: string, body = '#efd9b0') {
  return group(
    mesh(sphere(0.15), body, [0, 0.15, 0], [0, 0, 0], [1, 1.15, 0.8]),
    mesh(cyl(0.05, 0.09, 0.07, 10), body, [0, 0.33, 0]),
    mesh(new THREE.TorusGeometry(0.055, 0.015, 6, 12), '#c98e58', [0, 0.31, 0], [Math.PI / 2, 0, 0]),
    mesh(rbox(0.16, 0.1, 0.04, 0.02), label, [0, 0.15, 0.11]),
  )
}

export function item(k: string): THREE.Object3D {
  const [kind, id] = k.split(':')
  if (kind === 'crop') return produce(id)
  if (kind === 'seed') return sack(CROP_COLOR[id] || '#888')
  if (kind === 'feed') {
    const g = sack('#ffd84f', '#e7c98f')
    for (let i = 0; i < 4; i++) g.add(mesh(sphere(0.022, 6, 4), '#ffd84f', [-0.05 + i * 0.03, 0.38, (i % 2) * 0.02]))
    return g
  }
  if (kind === 'box') {
    const g = group(mesh(rbox(0.36, 0.26, 0.36, 0.04), PALETTE.cardboard, [0, 0.13, 0]), mesh(rbox(0.37, 0.03, 0.09, 0.01), '#ff9fb5', [0, 0.27, 0]))
    const sticker = produce(id)
    sticker.scale.setScalar(0.55)
    sticker.position.set(0, 0.28, 0)
    g.add(sticker)
    return g
  }
  if (kind === 'tool') {
    if (id === 'hoe') {
      // ด้ามยาวนอนแนวนอน ใบจอบห้อยลงที่ปลาย — วางบนโต๊ะแล้วอ่านออกว่าเป็นจอบ
      return group(
        mesh(cyl(0.03, 0.03, 0.7, 8), PALETTE.woodLight, [0, 0.08, 0], [0, 0, Math.PI / 2]),
        mesh(rbox(0.07, 0.17, 0.22, 0.03), '#a9b8c9', [0.33, 0.02, 0]),
        mesh(rbox(0.08, 0.06, 0.08, 0.02), '#ff8fa8', [0.3, 0.1, 0]),
      )
    }
    if (id === 'can') {
      return group(
        mesh(cyl(0.13, 0.15, 0.24, 16), '#7fd0f5', [0, 0.14, 0]),
        mesh(cyl(0.025, 0.03, 0.3, 8), '#7fd0f5', [0.18, 0.2, 0], [0, 0, -0.9]),
        mesh(cyl(0.05, 0.03, 0.05, 10), '#7fd0f5', [0.3, 0.3, 0], [0, 0, -0.9]),
        mesh(new THREE.TorusGeometry(0.1, 0.022, 6, 14, Math.PI), '#4fb0dd', [0, 0.28, 0], [0, Math.PI / 2, 0]),
        mesh(sphere(0.04, 8, 6), '#ffffff', [0, 0.16, 0.14], [0, 0, 0], [1, 1, 0.3]),
      )
    }
    if (id === 'sickle') return group(mesh(cyl(0.03, 0.03, 0.3, 8), PALETTE.woodLight, [0, 0.15, 0]), mesh(new THREE.TorusGeometry(0.14, 0.028, 6, 14, Math.PI * 1.2), '#dfe7ef', [0.12, 0.34, 0], [0, 0, 0.3]))
    if (id === 'sprinkler') return sprinkler()
    if (id === 'scarecrow') return scarecrow()
  }
  return mesh(sphere(0.12), '#999', [0, 0.12, 0])
}

/** สปริงเกอร์ — หัวหมุน (userData.spin) World หมุนให้ตอนวางบนพื้น */
function sprinkler() {
  const head = group(
    mesh(cyl(0.05, 0.05, 0.05, 10), '#ffd84f', [0, 0, 0]),
    mesh(capsule(0.02, 0.24), '#ffd84f', [0, 0.02, 0], [0, 0, Math.PI / 2]),
    mesh(sphere(0.03, 8, 6), '#6fb7ff', [0.14, 0.02, 0]),
    mesh(sphere(0.03, 8, 6), '#6fb7ff', [-0.14, 0.02, 0]),
  )
  head.position.y = 0.34
  head.userData.spin = true
  return group(mesh(cyl(0.13, 0.16, 0.06, 14), '#6fb7ff', [0, 0.03, 0]), mesh(cyl(0.03, 0.03, 0.3, 8), '#b8c4d4', [0, 0.18, 0]), head)
}

/** หุ่นไล่กา — หัวกระสอบหน้ายิ้ม หมวกฟาง เสื้อลายสก็อต */
function scarecrow() {
  return group(
    mesh(cyl(0.025, 0.025, 0.7, 6), PALETTE.woodDark, [0, 0.35, 0]),
    mesh(capsule(0.025, 0.46), PALETTE.woodDark, [0, 0.5, 0], [0, 0, Math.PI / 2]),
    mesh(rbox(0.26, 0.26, 0.14, 0.05), '#ff8f6b', [0, 0.46, 0]),
    mesh(rbox(0.1, 0.12, 0.1, 0.03), '#f5cf6b', [-0.25, 0.46, 0]),
    mesh(rbox(0.1, 0.12, 0.1, 0.03), '#f5cf6b', [0.25, 0.46, 0]),
    mesh(sphere(0.13), '#efd9b0', [0, 0.72, 0]),
    face(0.11, 0.73, 0.127),
    mesh(cyl(0.22, 0.22, 0.02, 16), '#f5cf6b', [0, 0.82, 0]),
    mesh(cyl(0.1, 0.12, 0.1, 14), '#f5cf6b', [0, 0.87, 0]),
    mesh(cyl(0.121, 0.121, 0.03, 14), '#ff6b6b', [0, 0.84, 0]),
  )
}

// ── สัตว์ ──────────────────────────────────────────────────────────────

export interface AnimalRig {
  root: THREE.Group
  head: THREE.Object3D // ก้มจิก/เคี้ยว
  tail: THREE.Object3D
  product: THREE.Object3D // ไข่/ถังนม ที่โผล่ตอนพร้อมเก็บ
}

export function animal(type: 'chicken' | 'cow'): AnimalRig {
  return type === 'cow' ? cow() : chicken()
}

function chicken(): AnimalRig {
  const root = new THREE.Group()
  // รังฟาง
  root.add(mesh(rbox(0.86, 0.14, 0.86, 0.06), PALETTE.wood, [0, 0.07, 0]))
  root.add(mesh(new THREE.TorusGeometry(0.26, 0.08, 8, 18), '#f2cf6e', [0, 0.18, 0], [Math.PI / 2, 0, 0]))
  const body = group(
    mesh(sphere(0.2), '#ffffff', [0, 0.36, 0], [0, 0, 0], [1, 0.9, 1.1]),
    mesh(sphere(0.1), '#ffffff', [0.18, 0.38, -0.02], [0, 0, 0], [0.4, 0.8, 1]), // ปีก
    mesh(sphere(0.1), '#ffffff', [-0.18, 0.38, -0.02], [0, 0, 0], [0.4, 0.8, 1]),
  )
  root.add(body)
  const tail = group(mesh(cone(0.07, 0.16, 8), '#ffffff', [0, 0, 0], [-0.8, 0, 0]))
  tail.position.set(0, 0.46, -0.2)
  root.add(tail)
  const head = new THREE.Group()
  head.position.set(0, 0.5, 0.14)
  head.add(
    mesh(sphere(0.14), '#ffffff', [0, 0.08, 0.02]),
    mesh(cone(0.04, 0.08, 8), '#ffb43c', [0, 0.06, 0.17], [Math.PI / 2, 0, 0]),
    mesh(sphere(0.035, 8, 6), '#ff5a5a', [0, 0.0, 0.14], [0, 0, 0], [0.8, 1.4, 0.8]), // เหนียง
    mesh(sphere(0.04, 8, 6), '#ff5a5a', [0, 0.22, 0.0]),
    mesh(sphere(0.035, 8, 6), '#ff5a5a', [0, 0.21, 0.06]),
    mesh(sphere(0.035, 8, 6), '#ff5a5a', [0, 0.2, -0.05]),
    face(0.12, 0.1, 0.155),
  )
  root.add(head)
  for (const s of [-1, 1]) root.add(mesh(cyl(0.015, 0.015, 0.08, 5), '#ffb43c', [s * 0.07, 0.2, 0.02]))
  const product = mesh(sphere(0.07, 12, 10), CROP_COLOR.egg, [0.26, 0.24, 0.2], [0, 0, 0], [1, 1.3, 1])
  root.add(product)
  return { root, head, tail, product }
}

function cow(): AnimalRig {
  const root = new THREE.Group()
  root.add(mesh(rbox(0.92, 0.1, 0.92, 0.05), '#f2cf6e', [0, 0.05, 0])) // ฟางรองพื้น
  const white = '#ffffff'
  const spot = '#3b3340'
  root.add(mesh(rbox(0.46, 0.36, 0.66, 0.16), white, [0, 0.46, -0.04]))
  root.add(mesh(sphere(0.1, 10, 8), spot, [0.2, 0.52, -0.1], [0, 0, 0], [0.4, 1, 1.2]))
  root.add(mesh(sphere(0.08, 10, 8), spot, [-0.21, 0.44, 0.1], [0, 0, 0], [0.4, 1, 1]))
  root.add(mesh(sphere(0.09, 10, 8), spot, [0.05, 0.64, -0.2], [0, 0, 0], [1.2, 0.3, 1]))
  for (const [x, z] of [[-0.15, 0.2], [0.15, 0.2], [-0.15, -0.26], [0.15, -0.26]]) root.add(mesh(capsule(0.06, 0.16), white, [x, 0.2, z]), mesh(cyl(0.065, 0.065, 0.06, 10), '#6b5a55', [x, 0.12, z]))
  root.add(mesh(sphere(0.07, 10, 8), '#ffb3c6', [0, 0.3, -0.12], [0, 0, 0], [1, 0.6, 1])) // เต้านม
  const tail = group(mesh(cyl(0.015, 0.015, 0.28, 5), white, [0, -0.14, 0]), mesh(sphere(0.04, 8, 6), spot, [0, -0.3, 0]))
  tail.position.set(0, 0.6, -0.38)
  root.add(tail)
  const head = new THREE.Group()
  head.position.set(0, 0.62, 0.3)
  head.add(
    mesh(sphere(0.2), white, [0, 0.04, 0.04], [0, 0, 0], [1, 0.95, 0.95]),
    mesh(rbox(0.28, 0.14, 0.14, 0.06), '#ffb3c6', [0, -0.06, 0.18]),
    mesh(sphere(0.02, 6, 4), '#d9708e', [-0.06, -0.05, 0.25]),
    mesh(sphere(0.02, 6, 4), '#d9708e', [0.06, -0.05, 0.25]),
    mesh(cone(0.035, 0.1, 8), '#fff1c9', [-0.11, 0.24, 0], [0, 0, 0.4]),
    mesh(cone(0.035, 0.1, 8), '#fff1c9', [0.11, 0.24, 0], [0, 0, -0.4]),
    mesh(sphere(0.06, 8, 6), white, [-0.22, 0.12, 0], [0, 0, 0.5], [1.6, 0.6, 0.9]),
    mesh(sphere(0.06, 8, 6), white, [0.22, 0.12, 0], [0, 0, -0.5], [1.6, 0.6, 0.9]),
    mesh(sphere(0.06, 8, 6), spot, [0.08, 0.16, 0.12], [0, 0, 0], [1, 0.8, 0.5]),
    face(0.15, 0.08, 0.225, false),
  )
  root.add(head)
  const product = group(mesh(cyl(0.1, 0.09, 0.2, 14), '#c9d4e3', [0, 0.1, 0]), mesh(cyl(0.085, 0.085, 0.01, 14), '#ffffff', [0, 0.195, 0]))
  product.position.set(0.34, 0.1, 0.3)
  root.add(product)
  return { root, head, tail, product }
}

// ── ตัวละคร ────────────────────────────────────────────────────────────

export interface Character {
  root: THREE.Group
  body: THREE.Group
  head: THREE.Group
  eyes: THREE.Object3D[]
  legL: THREE.Object3D
  legR: THREE.Object3D
  armL: THREE.Object3D
  armR: THREE.Object3D
  hand: THREE.Group // ของในมือไปแปะที่นี่
}

const SKIN = ['#ffe0c7', '#ffd3b0', '#f2c19a', '#e6ad85']
const HAIR = ['#6b4632', '#3b2a22', '#e8b44a', '#b8623b', '#5a4a6b']

/** ชาวนา chibi หัวโต หน้ามีตา/แก้ม — หมวกและสีเสื้อตาม index สีผู้เล่น (8 สี × หมวก 5 แบบ วนกัน) */
export function character(colorIdx: number): Character {
  const shirt = PLAYER_COLORS[colorIdx % PLAYER_COLORS.length]
  const skin = SKIN[colorIdx % SKIN.length]
  const hair = HAIR[(colorIdx * 3) % HAIR.length]
  const denim = '#5b8fd9'
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)

  const leg = () => {
    const g = group(mesh(capsule(0.065, 0.08), denim, [0, -0.08, 0]), mesh(sphere(0.08, 10, 8), '#8a5a3c', [0, -0.18, 0.03], [0, 0, 0], [1, 0.7, 1.3]))
    return g
  }
  const legL = leg()
  const legR = leg()
  legL.position.set(-0.09, 0.24, 0)
  legR.position.set(0.09, 0.24, 0)
  body.add(legL, legR)

  // ตัว: เสื้อสีผู้เล่น + เอี๊ยมยีนส์
  body.add(mesh(capsule(0.17, 0.12), shirt, [0, 0.42, 0]))
  body.add(mesh(capsule(0.175, 0.04), denim, [0, 0.36, 0], [0, 0, 0], [1, 1, 1.02]))
  body.add(mesh(rbox(0.18, 0.12, 0.04, 0.02), denim, [0, 0.47, 0.155]))
  for (const s of [-1, 1]) body.add(mesh(sphere(0.02, 6, 4), '#ffd84a', [s * 0.07, 0.52, 0.17]))

  const arm = () => group(mesh(capsule(0.05, 0.14), shirt, [0, -0.09, 0]), mesh(sphere(0.055, 10, 8), skin, [0, -0.2, 0]))
  const armL = arm()
  const armR = arm()
  armL.position.set(-0.22, 0.55, 0)
  armR.position.set(0.22, 0.55, 0)
  body.add(armL, armR)

  // หัว
  const head = new THREE.Group()
  head.position.y = 0.84
  head.add(mesh(sphere(0.27, 20, 16), skin, [0, 0, 0]))
  head.add(mesh(sphere(0.28, 20, 16), hair, [0, 0.05, -0.04], [0, 0, 0], [1, 0.9, 0.92])) // ผมด้านหลัง/บน
  head.add(mesh(sphere(0.1, 10, 8), hair, [-0.12, 0.17, 0.17], [0, 0, 0.4], [1.3, 0.55, 0.6])) // ผมหน้าม้า
  head.add(mesh(sphere(0.09, 10, 8), hair, [0.1, 0.18, 0.18], [0, 0, -0.5], [1.3, 0.55, 0.6]))
  const eyes: THREE.Object3D[] = []
  for (const s of [-1, 1]) {
    const eye = group(mesh(sphere(0.042, 12, 10), PALETTE.eye, [0, 0, 0], [0, 0, 0], [1, 1.3, 0.6]), mesh(sphere(0.016, 6, 4), '#ffffff', [0.012, 0.02, 0.022]))
    eye.position.set(s * 0.1, -0.035, 0.255)
    eyes.push(eye)
    head.add(eye)
    head.add(mesh(sphere(0.045, 10, 6), mat(PALETTE.blush, { transparent: true, opacity: 0.8 }), [s * 0.17, -0.1, 0.2], [0, s * 0.5, 0], [1, 0.6, 0.35]))
  }
  head.add(mesh(new THREE.TorusGeometry(0.035, 0.01, 6, 12, Math.PI), '#7a3b2e', [0, -0.11, 0.245], [0.45, 0, Math.PI])) // ปากยิ้ม
  head.add(hat(colorIdx, shirt))
  body.add(head)

  const hand = new THREE.Group()
  hand.position.set(0, 0.5, 0.3)
  body.add(hand)
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true
  })
  return { root, body, head, eyes, legL, legR, armL, armR, hand }
}

function hat(idx: number, color: string) {
  switch (idx % 5) {
    case 0: // หมวกฟาง + ริบบิ้นสีผู้เล่น
      return group(
        mesh(cyl(0.4, 0.4, 0.03, 20), '#f5d27a', [0, 0.2, 0]),
        mesh(cyl(0.2, 0.24, 0.16, 18), '#f5d27a', [0, 0.28, 0]),
        mesh(cyl(0.242, 0.242, 0.05, 18), color, [0, 0.23, 0]),
      )
    case 1: // หมวกแก๊ป
      return group(mesh(dome(0.29), color, [0, 0.08, -0.01], [0, 0, 0], [1, 0.8, 1]), mesh(rbox(0.3, 0.03, 0.2, 0.015), color, [0, 0.12, 0.25], [0.15, 0, 0]), mesh(sphere(0.03, 8, 6), '#ffffff', [0, 0.31, 0]))
    case 2: // หมวกไหมพรม + ปอมปอม
      return group(mesh(dome(0.29), color, [0, 0.1, -0.01], [0, 0, 0], [1, 0.95, 1]), mesh(cyl(0.295, 0.295, 0.07, 18), '#ffffff', [0, 0.11, -0.01]), mesh(sphere(0.08, 10, 8), '#ffffff', [0, 0.41, 0]))
    case 3: // ฮู้ดหูกระต่าย
      return group(
        mesh(dome(0.3), color, [0, 0.07, -0.02]),
        mesh(capsule(0.06, 0.2), color, [-0.12, 0.38, -0.02], [0, 0, 0.2]),
        mesh(capsule(0.06, 0.2), color, [0.12, 0.38, -0.02], [0, 0, -0.2]),
        mesh(capsule(0.03, 0.16), '#ffc4dd', [-0.12, 0.38, 0.03], [0, 0, 0.2]),
        mesh(capsule(0.03, 0.16), '#ffc4dd', [0.12, 0.38, 0.03], [0, 0, -0.2]),
      )
    default: // ต้นกล้างอกบนหัว + กิ๊บดอกไม้
      return group(
        mesh(cyl(0.012, 0.012, 0.14, 5), '#5fb548', [0, 0.33, 0]),
        mesh(sphere(0.06, 8, 6), '#6fcf55', [-0.05, 0.41, 0], [0, 0, 0.6], [1, 0.4, 0.6]),
        mesh(sphere(0.06, 8, 6), '#6fcf55', [0.05, 0.41, 0], [0, 0, -0.6], [1, 0.4, 0.6]),
        flower(0.18, 0.12, color, 0.02).translateY(0.1),
      )
  }
}
