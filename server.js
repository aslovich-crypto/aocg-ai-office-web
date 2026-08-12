// Production static server with SPA history fallback.
// Start Command = `npm run start`, Build Command = `npm run build`.
//
// ПОРТ БЕРЁТСЯ ИЗ ОКРУЖЕНИЯ, С ЗАПАСНЫМ 4173 (S-06, находка перед переездом).
// Было жёстко 4173 — «legacy from vite preview»: публичный домен на Railway
// маршрутизировался именно туда, и это работало, пока площадка одна.
// Любая другая площадка (Timeweb App Platform и все прочие) сообщает порт
// ПЕРЕМЕННОЙ PORT и ждёт, что приложение будет слушать именно его. Жёсткое
// число означало бы, что после переезда сервис поднимается, отвечает сам себе
// и остаётся недоступным снаружи — то есть падение без единой ошибки в логах.
// Запасное 4173 сохранено намеренно: локальный запуск и текущая конфигурация
// Railway продолжают работать без изменений, пока переезд не состоялся.
// Явный импорт, а не глобальный process — как в vite.config.js: eslint
// проверяет этот файл браузерными правилами, и глобального `process`
// в них нет. Линтер это и поймал: «'process' is not defined» (T8).
import process from "node:process";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(__dirname, "dist");
const port = Number(process.env.PORT) || 4173;

const app = express();
app.use(express.static(dist));
// Any route that isn't a real file → index.html, so client-side paths like
// /login, /register, /verify-email and /join/:token load the app (no 404).
app.use((req, res) => res.sendFile(path.join(dist, "index.html")));

app.listen(port, "0.0.0.0", () =>
  console.log(`[web] serving ${dist} on :${port}`),
);
