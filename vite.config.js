import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: ตั้งชื่อให้ตรงกับชื่อ repo ถ้าจะ deploy ขึ้น GitHub Pages
export default defineConfig({
  plugins: [react()],
  base: '/library-booking-v2/',
  server: { port: 5174, strictPort: true },
})
