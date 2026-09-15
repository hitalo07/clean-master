import { defineConfig } from 'electron-vite'
// Os scripts npm removem ELECTRON_RUN_AS_NODE — o Cursor herda essa variável e o Electron sobe como Node.
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react(), tailwindcss()]
  }
})
