import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    fs: { allow: ["src", "public", "node_modules", "index.html"] },
    watch: { usePolling: true, ignored: ["**/data/local/**", "**/.runtime/**"] },
  },
  build: { target: "es2022" },
});
