// ต่างเวลาระหว่างเครื่องเรากับ server — ทุก payload ที่มี serverNow จะมาอัปเดตค่านี้
// ใช้คำนวณระยะโตของพืชและนับถอยหลังออเดอร์ให้ตรงกับที่ server ตัดสิน แม้นาฬิกามือถือจะเพี้ยน
let offset = 0

export function syncClock(serverNow: number | undefined) {
  if (typeof serverNow === 'number') offset = serverNow - Date.now()
}

export function now() {
  return Date.now() + offset
}
