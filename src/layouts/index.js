import { KIND_LABEL, QUIET_SEATS } from './quietZone.js'

// ที่นั่งของแต่ละโซน — โซนไหนมีผังแล้วให้เพิ่มเข้ามาที่นี่
const SEATS_BY_ZONE = { quiet: QUIET_SEATS }

export const findSeat = (zoneId, seatId) => SEATS_BY_ZONE[zoneId]?.find((s) => s.id === seatId)

// ชื่อที่นั่งแบบอ่านง่าย เช่น "โต๊ะเดี่ยว D14", "ห้องเงียบ ห้อง 2"
export function seatName(zoneId, seatId) {
  const seat = findSeat(zoneId, seatId)
  if (!seat) return seatId
  return `${KIND_LABEL[seat.kind]} ${seat.label ?? seat.id}`
}
