import { ArrowLeft, MonitorPlay, Sofa, VolumeX } from 'lucide-react'
import { Link, Navigate, useParams } from 'react-router-dom'
import Header from '../components/Header.jsx'
import QuietFloorPlan from '../components/QuietFloorPlan.jsx'
import { ACCENT, getZone } from '../data.js'

const ICONS = { MonitorPlay, Sofa, VolumeX }

// หน้าถัดไปหลังเลือกโซน — ตอนนี้ยังเป็นหน้าเปล่ารอใส่ผังที่นั่ง
export default function ZonePage() {
  const { zoneId } = useParams()
  const zone = getZone(zoneId)

  // พิมพ์ URL โซนที่ไม่มีอยู่จริง -> กลับไปหน้าเลือกโซน
  if (!zone) return <Navigate to="/" replace />

  const Icon = ICONS[zone.icon]
  const color = ACCENT[zone.accent]

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />

      <main className="mx-auto max-w-5xl px-5 py-10">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-800"
        >
          <ArrowLeft className="h-4 w-4" />
          กลับไปเลือกโซน
        </Link>

        <div className="mt-5 flex items-start gap-4">
          <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl ${color.icon}`}>
            <Icon className="h-7 w-7" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">{zone.name}</h1>
            <p className="mt-1 text-slate-500">{zone.description}</p>
          </div>
        </div>

        {/* โซนที่วาดผังไว้แล้วก็แสดงผัง ที่เหลือยังเป็นหน้าเปล่ารอทำต่อ */}
        {zone.id === 'quiet' ? (
          <div className="mt-8">
            <QuietFloorPlan />
          </div>
        ) : (
          <div className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
            <p className="font-medium text-slate-600">ผังที่นั่งของ{zone.name}</p>
            <p className="mt-1 text-sm text-slate-400">ส่วนเลือกที่นั่งและจองเวลา จะมาในขั้นถัดไป</p>
          </div>
        )}
      </main>
    </div>
  )
}
