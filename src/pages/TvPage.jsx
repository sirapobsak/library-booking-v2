import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, Eye, Maximize, Repeat } from 'lucide-react'
import EyeView from '../components/tv/EyeView.jsx'
import StatsView from '../components/tv/StatsView.jsx'
import { useNoiseAlert, useTvState } from '../tv.js'

// ============================================================
//  จอทีวีในโซนเงียบ (เปิดค้างไว้บนทีวี ไม่ต้องล็อกอิน)
//   #/tv        ตาที่มองไปรอบห้อง — เสียงดังที่โต๊ะไหน ตามองไปที่นั่น + ขอบจอแดง
//   #/tv/stats  สถิติ วันนี้ vs เมื่อวาน (ชวนทั้งห้องแข่งกันเงียบ)
//   #/tv/auto   สลับ 2 หน้าทุก 20 วินาที (มีเสียงดังเมื่อไร เด้งกลับหน้าตาทันที)
// ============================================================

const ZONE = 'quiet'
const ROTATE_MS = 20000

export default function TvPage({ mode }) {
  const { data, error, ageMs } = useTvState(ZONE)
  const alert = useNoiseAlert(data, ageMs)
  const [autoView, setAutoView] = useState('eye')

  useEffect(() => {
    if (mode !== 'auto') return
    const t = setInterval(() => setAutoView((v) => (v === 'eye' ? 'stats' : 'eye')), ROTATE_MS)
    return () => clearInterval(t)
  }, [mode])

  const view = mode === 'auto' ? (alert ? 'eye' : autoView) : mode

  return (
    <div className="fixed inset-0 select-none overflow-hidden bg-[#0d0d0d] text-white">
      {view === 'eye' ? (
        <EyeView data={data} alert={alert} ageMs={ageMs} />
      ) : (
        <StatsView data={data} ageMs={ageMs} />
      )}

      {/* ขอบจอแดงเมื่อตรวจพบเสียงดัง */}
      {alert && <div className="tv-alarm pointer-events-none absolute inset-0" aria-hidden />}

      {error && (
        <p className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-amber-500/15 px-5 py-2 text-sm text-amber-200 ring-1 ring-amber-500/30">
          {error}
        </p>
      )}

      <TvControls mode={mode} />
    </div>
  )
}

// ปุ่มเล็ก ๆ มุมขวาบน (จาง ๆ ไม่รบกวน เอาเมาส์ไปชี้ถึงจะชัด)
function TvControls({ mode }) {
  const item = (to, active, Icon, label) => (
    <Link
      to={to}
      title={label}
      aria-label={label}
      className={`grid h-10 w-10 place-items-center rounded-xl transition ${
        active ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'
      }`}
    >
      <Icon className="h-5 w-5" />
    </Link>
  )
  return (
    <nav className="absolute right-4 top-4 flex gap-1 rounded-2xl bg-black/40 p-1 opacity-30 transition hover:opacity-100 focus-within:opacity-100">
      {item('/tv', mode === 'eye', Eye, 'หน้าตา')}
      {item('/tv/stats', mode === 'stats', BarChart3, 'หน้าสถิติ')}
      {item('/tv/auto', mode === 'auto', Repeat, 'สลับอัตโนมัติทุก 20 วินาที')}
      <button
        type="button"
        title="เต็มจอ"
        aria-label="เต็มจอ"
        onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}
        className="grid h-10 w-10 place-items-center rounded-xl text-white/70 transition hover:bg-white/10 hover:text-white"
      >
        <Maximize className="h-5 w-5" />
      </button>
    </nav>
  )
}
