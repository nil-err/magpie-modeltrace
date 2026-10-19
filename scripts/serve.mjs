// A static server for dist/, so the page can be tried before it is deployed.
//
// Cloudflare Pages serves a directory; this does the same, with the MIME types
// a module-loaded page needs (a .mjs served as text/plain will not run).

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (url.pathname === "/" || url.pathname === "") file = path.join(ROOT, "index.html");
  if (!file.startsWith(ROOT)) {
    response.writeHead(403).end("forbidden");
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    // A one-page app: unknown paths are the page.
    if (path.extname(url.pathname)) {
      response.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    file = path.join(ROOT, "index.html");
  }
  const type = TYPES[path.extname(file)] || "application/octet-stream";
  response.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  fs.createReadStream(file).pipe(response);
});

server.listen(PORT, HOST, () => {
  console.log(`serving dist/ on http://${HOST}:${PORT}`);
});
