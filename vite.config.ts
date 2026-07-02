import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Proxy the play-time app's /api calls to the local authoring server.
  // Long timeouts: authoring a whole topic can take a couple of minutes.
  server: {
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: true, timeout: 600000, proxyTimeout: 600000 },
    },
  },
});
