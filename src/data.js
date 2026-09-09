// รายชื่อโซนในห้องสมุด — เพิ่ม/แก้โซนได้ที่ไฟล์นี้ไฟล์เดียว
// id ใช้เป็นส่วนหนึ่งของ URL เช่น /zone/e-lecture
export const ZONES = [
  {
    id: 'e-lecture',
    name: 'โซน E-Lecture',
    description: 'ที่นั่งพร้อมคอมพิวเตอร์และหูฟัง สำหรับเรียนออนไลน์และดูสื่อการสอน',
    icon: 'MonitorPlay',
    accent: 'sky',
  },
  {
    id: 'sofa',
    name: 'โซนโซฟา',
    description: 'ที่นั่งโซฟานั่งสบาย เหมาะกับการอ่านหนังสือแบบผ่อนคลาย',
    icon: 'Sofa',
    accent: 'violet',
  },
  {
    id: 'quiet',
    name: 'โซนเงียบ',
    description: 'ที่นั่งห้ามส่งเสียง สำหรับอ่านหนังสือและติวแบบต้องการสมาธิ',
    icon: 'VolumeX',
    accent: 'emerald',
  },
]

export const getZone = (id) => ZONES.find((z) => z.id === id)

// สีประจำโซน (เขียนเต็ม ๆ ไว้ เพราะ Tailwind ต้องเห็นชื่อคลาสตรง ๆ ตอน build)
export const ACCENT = {
  sky: {
    icon: 'bg-sky-100 text-sky-600',
    ring: 'hover:border-sky-300 hover:shadow-sky-100',
    bar: 'bg-sky-500',
  },
  violet: {
    icon: 'bg-violet-100 text-violet-600',
    ring: 'hover:border-violet-300 hover:shadow-violet-100',
    bar: 'bg-violet-500',
  },
  emerald: {
    icon: 'bg-emerald-100 text-emerald-600',
    ring: 'hover:border-emerald-300 hover:shadow-emerald-100',
    bar: 'bg-emerald-500',
  },
}
