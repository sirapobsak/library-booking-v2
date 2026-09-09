import { ChevronRight, MonitorPlay, Sofa, VolumeX } from 'lucide-react'
import { Link } from 'react-router-dom'
import Header from '../components/Header.jsx'
import { useAuth } from '../auth.jsx'
import { ACCENT, ZONES } from '../data.js'

// จับคู่ชื่อไอคอนใน data.js กับไอคอนจริงของ lucide
const ICONS = { MonitorPlay, Sofa, VolumeX }

export default function Zones() {
  const { user } = useAuth()

  return (
    <div className="min-h-screen bg-slate-50">
      <Header />

      <main className="mx-auto max-w-5xl px-5 py-10">
        <h1 className="text-2xl font-bold text-slate-800">สวัสดี {user.firstName} 👋</h1>
        <p className="mt-1 text-slate-500">เลือกโซนที่นั่งที่ต้องการจอง</p>

        {/* การ์ดโซน — กดที่การ์ดเพื่อไปหน้าถัดไปของโซนนั้น */}
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {ZONES.map((zone) => {
            const Icon = ICONS[zone.icon]
            const color = ACCENT[zone.accent]

            return (
              <Link
                key={zone.id}
                to={`/zone/${zone.id}`}
                className={`group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white
                            shadow-sm transition hover:-translate-y-1 hover:shadow-lg ${color.ring}`}
              >
                <span className={`h-1.5 w-full ${color.bar}`} />

                <div className="flex flex-1 flex-col p-6">
                  <span className={`grid h-12 w-12 place-items-center rounded-xl ${color.icon}`}>
                    <Icon className="h-6 w-6" />
                  </span>

                  <h2 className="mt-4 text-lg font-semibold text-slate-800">{zone.name}</h2>
                  <p className="mt-1.5 flex-1 text-sm leading-relaxed text-slate-500">
                    {zone.description}
                  </p>

                  <span className="mt-5 flex items-center gap-1 text-sm font-semibold text-sky-600">
                    เลือกโซนนี้
                    <ChevronRight className="h-4 w-4 transition group-hover:translate-x-1" />
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      </main>
    </div>
  )
}
