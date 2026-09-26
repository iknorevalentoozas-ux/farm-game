import { io, Socket } from 'socket.io-client'

export const SERVER_URL = (import.meta.env.VITE_SERVER_URL as string) || 'http://localhost:5454'

let socket: Socket | null = null

/** ต่อ socket เข้า farm-game server (ตัวเอง ไม่ใช่ backend เดิม) — เรียกครั้งเดียวหลังเลือกตัวตนแล้ว */
export function connectSocket(): Socket {
  if (socket) return socket
  socket = io(SERVER_URL, { transports: ['websocket', 'polling'] })
  return socket
}
