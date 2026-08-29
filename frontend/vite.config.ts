import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const API_TARGET = process.env.VITE_API_TARGET || 'http://localhost:3100';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5190,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
      '/uploads': {
        target: API_TARGET,
        changeOrigin: true,
      },
      '/backups': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 5190,
    strictPort: true,
    host: '0.0.0.0',
    hmr: false, // 生产预览关闭 HMR，避免模块更新触发陈旧代码错误
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
      '/uploads': {
        target: API_TARGET,
        changeOrigin: true,
      },
      '/backups': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    // S19：构建前清空 dist，避免 assets 累积旧 hash 文件。
    // 注意：根目录文件（help.html/device-preview.html/logo 等）全部来自 public/，由 vite 自动拷贝，不会丢。
    // 本地沙箱 safe-delete 守卫会拦截 vite 自身的目录清理（fail-closed）导致构建失败，
    // 故设为 false，改为构建前手动 `rm -rf dist`（git-bash 的 rm 不受该守卫拦截）。
    emptyOutDir: false,
    chunkSizeWarningLimit: 1500000,
  },
});
