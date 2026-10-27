/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages ではリポジトリ名のサブパス（https://<user>.github.io/NS-SIM/）で配信される。
// ルート配信のホスティング（Cloudflare Pages 等）では BASE_PATH=/ を指定してビルドする。
const PAGES_BASE = '/NS-SIM/';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: process.env.BASE_PATH ?? (command === 'build' ? PAGES_BASE : '/'),
  build: {
    // 公開成果物にソースコードを含めない
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
}));
