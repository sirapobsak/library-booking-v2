import { AlertCircle, Star, Volume2 } from 'lucide-react'
import Header from '../components/Header.jsx'
import { useMyPoints } from '../points.js'

// หน้า "คะแนนสะสม" ของผู้ใช้ — เห็นแค่คะแนนของตัวเอง (ปรับคะแนนได้เฉพาะผู้ดูแล)
export default function MyPoints() {
  const { points, loading, installed, penalty, sensorEnabled } = useMyPoints()

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />

      <main className="mx-auto max-w-xl px-5 py-10">
        <h1 className="text-2xl font-bold text-slate-800">คะแนนสะสม</h1>

        {!installed ? (
          <div className="mt-6 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <p>ระบบคะแนนสะสมยังไม่เปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ</p>
          </div>
        ) : (
          <>
            <div className="relative mt-6 overflow-hidden rounded-3xl bg-gradient-to-br from-amber-400 via-amber-500 to-orange-500 p-8 text-white shadow-lg shadow-amber-200">
              {/* ดาวจาง ๆ ตกแต่งมุมขวา */}
              <Star className="absolute -right-6 -top-6 h-40 w-40 fill-white/15 text-white/0" aria-hidden />
              <p className="flex items-center gap-2 text-sm font-medium text-amber-50">
                <Star className="h-4 w-4 fill-white text-white" />
                คะแนนสะสมของคุณ
              </p>
              <p className="mt-3 text-6xl font-bold tabular-nums tracking-tight">{loading ? '–' : points}</p>
              <p className="mt-1 text-lg text-amber-50">แต้ม</p>
            </div>

            {sensorEnabled && penalty > 0 && (
              <p className="mt-4 flex gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-600">
                <Volume2 className="h-5 w-5 shrink-0 text-amber-500" />
                โต๊ะในห้องสมุดมีเซนเซอร์ตรวจจับเสียง ถ้าตรวจพบเสียงดังที่โต๊ะที่คุณจองหรือเข้าร่วมอยู่
                จะถูกหักครั้งละ {penalty} แต้ม
              </p>
            )}
          </>
        )}
      </main>
    </div>
  )
}
