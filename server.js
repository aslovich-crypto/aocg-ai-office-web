// Production static server with SPA history fallback.
// Railway: Start Command = `npm run start`, Build Command = `npm run build`.
// This service's public domain routes to port 4173 (legacy from vite preview),
// so we listen there — not on $PORT — to match the existing networking config.
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(__dirname, "dist");
const port = 4173;

const app = express();
app.use(express.static(dist));
// Any route that isn't a real file → index.html, so client-side paths like
// /login, /register, /verify-email and /join/:token load the app (no 404).
app.use((req, res) => res.sendFile(path.join(dist, "index.html")));

app.listen(port, "0.0.0.0", () =>
  console.log(`[web] serving ${dist} on :${port}`),
);
