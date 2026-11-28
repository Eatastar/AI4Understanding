import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const { productName, shortName, version, buildId, buildTime } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_BRAND_LOGO_URL': JSON.stringify('/assets/ai4u-logo.svg?v=' + buildId),
    __APP_NAME__: JSON.stringify(productName),
    __APP_SHORT_NAME__: JSON.stringify(shortName),
    __APP_VERSION__: JSON.stringify(version),
    __APP_BUILD__: JSON.stringify(buildId),
    __APP_BUILD_TIME__: JSON.stringify(buildTime),
  },
  server: {
    host: '127.0.0.1',
    port: 4317,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:4318' },
  },
});
