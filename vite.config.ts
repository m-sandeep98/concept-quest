import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // `node_modules` here is a SYMLINK to a sibling checkout (git worktrees share one
    // install), so its real path sits outside Vite's default fs allow-list and asset
    // files (e.g. @fontsource fonts) get rejected with "outside of Vite serving allow
    // list". Relax strict fs so the LOCAL dev server can serve them. Dev-only — this
    // has no effect on `vite build`.
    fs: { strict: false },
    // Proxy the play-time app's /api calls to the local authoring server.
    // Long timeouts: authoring a whole topic can take a couple of minutes.
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: true, timeout: 600000, proxyTimeout: 600000 },
    },
  },
});
