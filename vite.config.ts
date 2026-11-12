import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The Express token service (stage 2) runs on PORT (default 3001).
// Vite proxies /api to it so the browser only ever talks to one origin.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": `http://localhost:${process.env.PORT ?? 3001}`,
    },
  },
});
