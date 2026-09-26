import * as THREE from 'three'
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Theme } from '../level/collision'

// ท้องฟ้าพาสเทล (บน → ขอบฟ้า) — ขอบฟ้าใช้เป็นสีหมอกด้วย
const SKY: Record<Theme, [string, string]> = {
  grass: ['#7fd0ff', '#e8f8ff'],
  spring: ['#ffc6e0', '#fff3f8'],
  desert: ['#ffc98a', '#fff3dc'],
  snow: ['#b7d7f0', '#f6fbff'],
}

/**
 * ตัว render three.js: กล้องมุมเอียงแบบ Overcooked ตามตัวละคร, แสงแดดมีเงานุ่ม, ท้องฟ้าไล่สี, หมอก,
 * และชั้น CSS2D (ป้ายชื่อ/แถบความคืบหน้า/เลขลอย) ทับบน canvas
 * หน่วยโลก: 1 = 1 ช่อง (64px ของ server) — แปลงด้วย toWorld()
 */
export class Renderer {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200)
  readonly gl: THREE.WebGLRenderer
  readonly labels = new CSS2DRenderer()
  private sun = new THREE.DirectionalLight('#fff1dc', 2.0)
  private hemi = new THREE.HemisphereLight('#e6f6ff', '#8fbf6a', 1.35)
  private camTarget = new THREE.Vector3()
  private bounds = { w: 10, h: 10 }
  zoom = 1 // ทดสอบ: __farm.renderer.zoom = 0.5 ดูใกล้ๆ

  constructor(container: HTMLElement) {
    this.gl = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    this.gl.shadowMap.enabled = true
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap
    // Neutral: คงสีพาสเทลไว้ตรงๆ (ACES ดึงสีสดให้หม่นและอมส้ม ไม่เข้ากับลุคการ์ตูน)
    this.gl.toneMapping = THREE.NeutralToneMapping
    this.gl.toneMappingExposure = 1.0
    this.gl.outputColorSpace = THREE.SRGBColorSpace
    this.gl.domElement.style.touchAction = 'none'
    container.appendChild(this.gl.domElement)

    this.labels.domElement.style.position = 'absolute'
    this.labels.domElement.style.inset = '0'
    this.labels.domElement.style.pointerEvents = 'none'
    container.appendChild(this.labels.domElement)

    this.scene.add(this.hemi)
    this.sun.castShadow = true
    const small = Math.min(window.innerWidth, window.innerHeight) < 700
    this.sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048)
    this.sun.shadow.bias = -0.0006
    this.sun.shadow.normalBias = 0.02
    this.sun.shadow.radius = 4
    this.scene.add(this.sun, this.sun.target)

    this.resize()
    window.addEventListener('resize', () => this.resize())
  }

  /** ตั้งฉากใหม่ตามแผนที่ (ขนาด/ธีม) — เรียกทุกครั้งที่เริ่มรอบ */
  setLevel(wTiles: number, hTiles: number, theme: Theme) {
    this.bounds = { w: wTiles, h: hTiles }
    const [top, bottom] = SKY[theme]
    this.scene.background = skyTexture(top, bottom)
    this.scene.fog = new THREE.Fog(bottom, 22, 48)
    this.hemi.groundColor.set(theme === 'snow' ? '#c9d9e8' : theme === 'desert' ? '#d9b27a' : theme === 'spring' ? '#e0b3c8' : '#8fbf6a')
    // เงาครอบทั้งแผนที่ (แผนที่เล็ก ~18×12 ช่อง แสงเดียวพอ ไม่ต้องขยับตามตัวละคร)
    const cx = wTiles / 2
    const cz = hTiles / 2
    const span = Math.max(wTiles, hTiles) / 2 + 3
    this.sun.position.set(cx + 8, 16, cz + 10)
    this.sun.target.position.set(cx, 0, cz)
    const cam = this.sun.shadow.camera
    cam.left = -span
    cam.right = span
    cam.top = span
    cam.bottom = -span
    cam.near = 1
    cam.far = 50
    cam.updateProjectionMatrix()
  }

  /** ระยะกล้อง: จอแนวตั้ง (มือถือ) ถอยออกให้เห็นกว้างพอ */
  private camOffset() {
    const aspect = this.camera.aspect
    const k = aspect < 1 ? 1.3 : aspect < 1.4 ? 1.15 : 1
    return new THREE.Vector3(0, 9.5 * k * this.zoom, 6.8 * k * this.zoom)
  }

  follow(x: number, z: number, snap = false) {
    // บีบจุดที่กล้องมองให้อยู่ในแผนที่ (เว้นขอบ) ไม่ให้เห็นความว่างนอกแผนที่มากเกินไป
    const pad = 3
    const tx = THREE.MathUtils.clamp(x, Math.min(pad, this.bounds.w / 2), Math.max(this.bounds.w - pad, this.bounds.w / 2))
    const tz = THREE.MathUtils.clamp(z, Math.min(pad, this.bounds.h / 2), Math.max(this.bounds.h - pad, this.bounds.h / 2))
    const want = new THREE.Vector3(tx, 0, tz)
    if (snap) this.camTarget.copy(want)
    else this.camTarget.lerp(want, 0.12)
    this.camera.position.copy(this.camTarget).add(this.camOffset())
    this.camera.lookAt(this.camTarget.x, 0, this.camTarget.z - 0.6)
  }

  resize() {
    const w = window.innerWidth
    const h = window.innerHeight
    this.camera.aspect = w / h
    this.camera.fov = w / h < 1 ? 46 : 38
    this.camera.updateProjectionMatrix()
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 1.75)) // DPR เปลี่ยนได้ (ย้ายจอ/ซูม) — ไม่อัปเดตแล้วบัฟเฟอร์ผิดขนาด
    this.gl.setSize(w, h)
    this.labels.setSize(w, h)
  }

  render() {
    this.gl.render(this.scene, this.camera)
    this.labels.render(this.scene, this.camera)
  }

  /** รวม geometry ของฉากนิ่งทั้งหมดตามวัสดุ → เหลือไม่กี่ draw call (สำคัญมากบนมือถือ) */
  static mergeStatic(root: THREE.Object3D): THREE.Group {
    root.updateMatrixWorld(true)
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>()
    root.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const g = m.geometry.clone().applyMatrix4(m.matrixWorld)
      // ทุกชิ้นต้องมี attribute ชุดเดียวกันถึงจะรวมได้ — ตัด uv ทิ้ง (วัสดุไม่มี texture อยู่แล้ว)
      g.deleteAttribute('uv')
      const nonIndexed = g.index ? g.toNonIndexed() : g
      const list = byMat.get(m.material as THREE.Material) || []
      list.push(nonIndexed)
      byMat.set(m.material as THREE.Material, list)
    })
    const out = new THREE.Group()
    for (const [material, geos] of byMat) {
      const merged = mergeGeometries(geos, false)
      if (!merged) continue
      const mesh = new THREE.Mesh(merged, material)
      mesh.castShadow = true
      mesh.receiveShadow = true
      out.add(mesh)
    }
    return out
  }
}

export const toWorld = (px: number) => px / 64

function skyTexture(top: string, bottom: string) {
  const c = document.createElement('canvas')
  c.width = 2
  c.height = 256
  const g = c.getContext('2d')!
  const grad = g.createLinearGradient(0, 0, 0, 256)
  grad.addColorStop(0, top)
  grad.addColorStop(1, bottom)
  g.fillStyle = grad
  g.fillRect(0, 0, 2, 256)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
