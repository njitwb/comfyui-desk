import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/main',
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/preload',
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } }
    }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [
      // webview 是 Electron 原生标签，不能让 Vue 当作组件解析
      vue({ template: { compilerOptions: { isCustomElement: tag => tag === 'webview' } } })
    ],
    build: {
      outDir: 'dist/renderer',
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } }
    },
    server: { port: 5188 }
  }
})
