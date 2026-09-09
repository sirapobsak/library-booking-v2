import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './auth.jsx'
import './index.css'

// ใช้ HashRouter (URL จะมี #) เพื่อให้ deploy ขึ้น GitHub Pages ได้โดยไม่ต้องตั้งค่าเซิร์ฟเวอร์
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </HashRouter>
  </React.StrictMode>,
)
