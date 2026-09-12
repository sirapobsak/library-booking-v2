import { BadgeCheck, BookOpen, Coins, Flame, LogOut, QrCode, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth.jsx'
import { useMyPoints } from '../points.js'
import { LEVEL_STYLE } from './LevelBadge.jsx'

// แถบบนสุดของทุกหน้า (หลังล็อกอินแล้ว)
export default function Header() {
  const { user, logout } = useAuth()
  const { standing, coins, streak, level, installed, isAdmin } = useMyPoints()

  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3.5">
        <Link to="/" className="flex items-center gap-2 font-semibold text-slate-800">
          <BookOpen className="h-5 w-5 text-sky-600" />
          <span className="hidden sm:inline">ระบบจองห้องสมุด</span>
        </Link>

        <div className="flex items-center gap-2 sm:gap-3">
          {/* คะแนนสะสม: ความประพฤติ · เหรียญ · เงียบติดต่อกัน — กดดูหน้าคะแนนของฉัน */}
          {installed && (
            <Link
              to="/points"
              title="คะแนนสะสม (ความประพฤติ · เหรียญ · เงียบติดต่อกัน)"
              className="flex items-center gap-2.5 rounded-full bg-white px-3 py-1.5 text-sm font-semibold ring-1 ring-slate-200 transition hover:bg-slate-50"
            >
              <span className={`flex items-center gap-1 ${LEVEL_STYLE[level]?.text ?? 'text-slate-700'}`}>
                <BadgeCheck className="h-4 w-4" />
                <span className="tabular-nums">{standing ?? '–'}</span>
              </span>
              <span className="flex items-center gap-1 text-amber-600">
                <Coins className="h-4 w-4" />
                <span className="tabular-nums">{coins ?? '–'}</span>
              </span>
              {streak > 0 && (
                <span className="flex items-center gap-0.5 text-orange-500">
                  <Flame className="h-4 w-4 fill-orange-400" />
                  <span className="tabular-nums">{streak}</span>
                </span>
              )}
            </Link>
          )}
          {/* หน้าผู้ดูแล — เห็นเฉพาะผู้ดูแล */}
          {isAdmin && (
            <Link
              to="/admin"
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-sky-700 transition hover:bg-sky-50"
            >
              <ShieldCheck className="h-4 w-4" />
              <span className="hidden sm:inline">ผู้ดูแล</span>
            </Link>
          )}
          {/* เข้าร่วมโต๊ะที่เพื่อนจองไว้ ด้วยรหัส 6 หลัก */}
          <Link
            to="/join"
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-green-700 transition hover:bg-green-50"
          >
            <QrCode className="h-4 w-4" />
            <span className="hidden sm:inline">เข้าร่วมด้วยรหัส</span>
          </Link>
          <span className="hidden text-sm text-slate-500 lg:inline">
            {user.firstName} {user.lastName}
          </span>
          <button
            onClick={logout}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">ออกจากระบบ</span>
          </button>
        </div>
      </div>
    </header>
  )
}
