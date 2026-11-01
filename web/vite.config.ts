import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 产物落在仓库根的 dist/web,由控制台同源托管(03 §9)
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
