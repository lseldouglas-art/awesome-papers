import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: "dist-research",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve("research-workbench.html"),
    },
  },
});
