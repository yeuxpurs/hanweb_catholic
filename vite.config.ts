import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? './',
  plugins: [react(), tailwindcss()],
  root: path.resolve(import.meta.dirname, 'client'),
  envDir: import.meta.dirname,
  resolve: {alias: {'@':path.resolve(import.meta.dirname,'client/src'),'@shared':path.resolve(import.meta.dirname,'shared')}},
  build: {outDir:path.resolve(import.meta.dirname,'dist/public'),emptyOutDir:true,copyPublicDir:false},
  server: {host:'127.0.0.1',port:3000},
});
