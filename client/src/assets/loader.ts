import { SERVER_URL } from '../net/socket'

/** key -> URL เต็มของรูปที่แอดมินอัปโหลดไว้ (หน้า /admin ของ server) — ล้มเหลวก็คืน {} เกมยังเล่นได้ด้วยรูปทรงสำรอง */
export async function fetchAssets(): Promise<Record<string, string>> {
  try {
    const res = await fetch(`${SERVER_URL}/api/assets`)
    const data = (await res.json()) as { assets: Record<string, string> }
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(data.assets || {})) out[k] = `${SERVER_URL}${v}`
    return out
  } catch {
    return {}
  }
}
