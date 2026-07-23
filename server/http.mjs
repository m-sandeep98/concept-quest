// HTTP transport primitives: CORS policy, JSON/SSE responses, body reading, path-segment
// safety, and port binding. No knowledge of tickets, topics, or chat — route modules layer
// their own meaning on top of these.

// This server spawns `claude -p` (spends money) and writes files. It is local-only. Since
// both the dev app (Vite) and this server pick ports dynamically, we allow any localhost /
// 127.0.0.1 origin rather than a fixed port. Requests with NO Origin header (curl, or the
// app's own same-origin calls via the Vite proxy) are allowed; a genuinely cross-origin
// REMOTE page — whose Origin is its own domain, not localhost — is still refused, so a
// random page you happen to have open can't drive authoring or delete queue files.
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
export const originAllowed = (origin) => !origin || LOCAL_ORIGIN.test(origin);

// Ticket ids, content domains, and chat threads become path segments (queue/<id>.json,
// content/<domain>/, chat/<thread>.json). Reject anything that could escape its directory
// (`..`, slashes, etc.).
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;
export function safeSegment(value, what) {
  const v = String(value ?? "");
  if (v === "." || v === ".." || !SAFE_SEGMENT.test(v)) throw new Error(`invalid ${what}`);
  return v;
}

export function send(res, code, body) {
  const headers = {
    "content-type": "application/json",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "origin",
  };
  // Echo the origin back only when it's allow-listed (never a wildcard on a server
  // that can spend money / write files). `res.reqOrigin` is set per request by the server.
  if (res.reqOrigin && originAllowed(res.reqOrigin)) headers["access-control-allow-origin"] = res.reqOrigin;
  res.writeHead(code, headers);
  res.end(JSON.stringify(body));
}

// Server-Sent Events: stream authoring logs + Claude's live output to the browser.
export function sseInit(res) {
  const headers = {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    vary: "origin",
  };
  if (res.reqOrigin && originAllowed(res.reqOrigin)) headers["access-control-allow-origin"] = res.reqOrigin;
  res.writeHead(200, headers);
  res.write(": connected\n\n");
  return {
    send: (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    end: () => res.end(),
  };
}

export function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => {
      try {
        resolve(d ? JSON.parse(d) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

// Bind to the preferred port, scanning upward past any that are already in use.
export function listenOnFreePort(server, preferred, maxTries = 25) {
  return new Promise((resolve, reject) => {
    let port = preferred;
    let tries = 0;
    const cleanup = () => {
      server.off("error", onError);
      server.off("listening", onListening);
    };
    const onError = (e) => {
      if (e.code === "EADDRINUSE" && tries < maxTries) {
        tries += 1;
        port += 1;
        server.listen(port);
      } else {
        cleanup();
        reject(e);
      }
    };
    const onListening = () => {
      cleanup();
      resolve(server.address().port);
    };
    server.on("error", onError);
    server.on("listening", onListening);
    server.listen(port);
  });
}
