import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

// โมเดล .glb ที่แอดมินอัปโหลดผ่าน /admin แทน key ใดก็ได้ (เช่น 'tree-grass', 'truck', 'crop-carrot-3',
// 'item-box-carrot') — ถ้า key นั้นมีไฟล์ ใช้โมเดลนั้นแทนรูปทรงที่สร้างจากโค้ด ไม่มีก็ใช้ของเดิม
const templates = new Map<string, THREE.Object3D>()

export async function loadOverrides(assets: Record<string, string>) {
  const loader = new GLTFLoader()
  await Promise.all(
    Object.entries(assets)
      .filter(([, url]) => /\.glb(\?|$)/i.test(url))
      .map(async ([key, url]) => {
        try {
          const gltf = await loader.loadAsync(url)
          gltf.scene.traverse((o) => {
            const m = o as THREE.Mesh
            if (m.isMesh) {
              m.castShadow = true
              m.receiveShadow = true
            }
          })
          templates.set(key, gltf.scene)
        } catch (e) {
          console.warn('[overrides] load failed', key, e)
        }
      }),
  )
}

export function use(key: string, fallback: () => THREE.Object3D): THREE.Object3D {
  const t = templates.get(key)
  return t ? t.clone(true) : fallback()
}
