import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  worker: { format: 'es' },
  build: {
    target: 'es2022', // iOS Safari 16.4+ / Chrome 111+
    sourcemap: false,
    chunkSizeWarningLimit: 7000, // web-llm is a lazy chunk, loaded only for offline chat
  },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
});
