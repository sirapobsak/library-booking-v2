import { BookOpen, LogOut, QrCode } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth.jsx'

// แถบบนสุดของทุกหน้า (หลังล็อกอินแล้ว)
export default function Header() {
  const { user, logout } = useAuth()

  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3.5">
        <Link to="/" className="flex items-center gap-2 font-semibold text-slate-800">
          <BookOpen className="h-5 w-5 text-sky-600" />
          ระบบจองห้องสมุด
        </Link>

        <div className="flex items-center gap-3">
          {/* เข้าร่วมโต๊ะที่เพื่อนจองไว้ ด้วยรหัส 6 หลัก */}
          <Link
            to="/join"
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-green-700 transition hover:bg-green-50"
          >
            <QrCode className="h-4 w-4" />
            <span className="hidden sm:inline">เข้าร่วมด้วยรหัส</span>
          </Link>
          <span className="hidden text-sm text-slate-500 sm:inline">
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
