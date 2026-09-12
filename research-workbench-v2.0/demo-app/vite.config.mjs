import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
const appVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version;
const buildId = `${appVersion}-${Date.now()}`;
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  define: { __APP_BUILD_ID__: JSON.stringify(buildId), __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [react(), { name: 'app-version', generateBundle() { this.emitFile({ type: 'asset', fileName: 'app-version.json', source: JSON.stringify({ version: appVersion, buildId }) }); } }],
  envDir: false,
  build: { outDir: 'dist', emptyOutDir: false },
  server: { fs: { allow: [fileURLToPath(new URL('../', import.meta.url)), fileURLToPath(new URL('../../../node_modules', import.meta.url))] } },
});
