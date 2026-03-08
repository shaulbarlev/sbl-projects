import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
// Build for Cloudflare Pages at https://shaulb.com
export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
})
