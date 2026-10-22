import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// build:server → dist（Node 服务端提供）；build:static → dist-pages（GitHub Pages）
export default defineConfig(({ mode }) => {
  const staticMode = mode === 'static';
  return {
    plugins: [react()],
    base: '/hezuguanjia/',
    define: { __STATIC__: staticMode ? 'true' : 'false' },
    build: {
      outDir: staticMode ? 'dist-pages' : 'dist',
      sourcemap: false,
      chunkSizeWarningLimit: 900,
    },
    server: {
      port: 5173,
      proxy: {
        '/hezuguanjia/api': { target: 'http://127.0.0.1:4330', changeOrigin: true },
      },
    },
  };
});
