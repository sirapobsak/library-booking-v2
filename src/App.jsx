import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth.jsx'
import AuthPage from './pages/AuthPage.jsx'
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

  // ยังไม่ล็อกอิน -> ไม่ว่าจะเปิด URL ไหนก็เด้งไปหน้าล็อกอิน
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path="/" element={<Zones />} />          {/* หน้าเลือกโซน */}
      <Route path="/zone/:zoneId" element={<ZonePage />} /> {/* หน้าของแต่ละโซน */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
