import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth.jsx'
import AdminPage from './pages/AdminPage.jsx'
import AuthPage from './pages/AuthPage.jsx'
import JoinPage from './pages/JoinPage.jsx'
import MyPoints from './pages/MyPoints.jsx'
import Zones from './pages/Zones.jsx'
import ZonePage from './pages/ZonePage.jsx'

export default function App() {
  const { user, loading } = useAuth()

  // ระหว่างเช็คว่าเคยล็อกอินค้างไว้ไหม ให้แสดงหน้ารอสั้น ๆ กันจอกระพริบ
  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 text-slate-500">
        กำลังโหลด...
      </div>
    )
  }

  // ยังไม่ล็อกอิน -> เปิด URL ไหนก็เด้งไปหน้าล็อกอิน (จำหน้าที่ตั้งใจจะเข้าไว้ด้วย เช่นลิงก์จาก QR)
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route path="*" element={<RedirectToLogin />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path="/" element={<Zones />} /> {/* หน้าเลือกโซน */}
      <Route path="/zone/:zoneId" element={<ZonePage />} /> {/* หน้าของแต่ละโซน */}
      <Route path="/join" element={<JoinPage />} /> {/* กรอกรหัส 6 หลักเข้าร่วมโต๊ะ */}
      <Route path="/join/:code" element={<JoinPage />} /> {/* เปิดจาก QR */}
      <Route path="/points" element={<MyPoints />} /> {/* คะแนนสะสมของฉัน */}
      <Route path="/admin" element={<AdminPage />} /> {/* หน้าผู้ดูแล (เช็คสิทธิ์ข้างใน) */}
      {/* เพิ่งล็อกอินเสร็จ -> พากลับไปหน้าที่ตั้งใจจะเข้า */}
      <Route path="/login" element={<BackAfterLogin />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function RedirectToLogin() {
  const location = useLocation()
  return <Navigate to="/login" replace state={{ from: location.pathname }} />
}

function BackAfterLogin() {
  const location = useLocation()
  return <Navigate to={location.state?.from || '/'} replace />
}
