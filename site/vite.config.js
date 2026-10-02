import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: path.resolve(__dirname),
  oxc: {
    tsconfig: path.resolve(__dirname, 'tsconfig.json'),
  },
})
