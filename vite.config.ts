import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The authoring server picks its port dynamically. `npm run dev:all` starts both together and
// sets CQ_SERVER_PORT so this proxy targets the right one; a standalone `npm run dev` falls
// back to 8787 (the port the server prefers). `process` is declared locally so the config
// needs no @types/node. To point a standalone dev server at a non-default authoring port:
//   CQ_SERVER_PORT=<port> npm run dev
declare const process: { env: Record<string, string | undefined> };
const authoringPort = process.env.CQ_SERVER_PORT || "8787";

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
      "/api": {
        target: `http://localhost:${authoringPort}`,
        changeOrigin: true,
        timeout: 600000,
        proxyTimeout: 600000,
      },
    },
  },
});
