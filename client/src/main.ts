import { connectSocket } from './net/socket'
import { showLoginOverlay } from './ui/LoginOverlay'
import { mountChatPanel } from './ui/ChatPanel'
import { fetchAssets } from './assets/loader'
import { loadOverrides } from './render/overrides'
import { startGame } from './game'
import { initAudio } from './audio/engine'
import type { Snapshot } from './types'

async function bootstrap() {
  const app = document.getElementById('app')
  if (!app) throw new Error('#app missing')
  initAudio() // แตะหน้า login ครั้งแรกก็ปลดล็อกเสียงแล้ว — เพลงดังทันทีที่เข้าเกม

  const identity = await showLoginOverlay(app)
  // โมเดล .glb ที่อัปโหลดไว้ในหน้า /admin ต้องโหลดเสร็จก่อนสร้างฉาก (ฉากนิ่งสร้างครั้งเดียวต่อรอบ)
  const overrides = fetchAssets().then(loadOverrides)

  const socket = connectSocket()
  socket.on('connect', () => socket.emit('player:join', identity))
  socket.once('world:snapshot', async (snap: Snapshot) => {
    await overrides
    startGame(app, socket, snap)
    mountChatPanel(app, socket)
  })
}

bootstrap()
