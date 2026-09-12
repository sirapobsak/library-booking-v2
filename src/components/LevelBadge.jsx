import { LEVELS } from '../points.js'

// สีของแต่ละระดับสิทธิ์ (ความประพฤติ) — ใช้ร่วมกันทั้ง Header, หน้าคะแนนสะสม, หน้าผู้ดูแล
export const LEVEL_STYLE = {
  normal: { badge: 'bg-green-100 text-green-800', text: 'text-green-600' },
  warn: { badge: 'bg-yellow-100 text-yellow-800', text: 'text-yellow-600' },
  limit1: { badge: 'bg-orange-100 text-orange-800', text: 'text-orange-600' },
  limit2: { badge: 'bg-red-100 text-red-800', text: 'text-red-600' },
  suspended: { badge: 'bg-rose-100 text-rose-800', text: 'text-rose-600' },
}

// ป้ายระดับ เช่น "ปกติ", "จำกัดระดับ 1"
export default function LevelBadge({ level, className = '' }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${LEVEL_STYLE[level]?.badge ?? ''} ${className}`}>
      {LEVELS[level]?.label ?? level}
    </span>
  )
}
