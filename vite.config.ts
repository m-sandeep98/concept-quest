import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Proxy the play-time app's /api calls to the local authoring server.
  server: { proxy: { "/api": "http://localhost:8787" } },
});
