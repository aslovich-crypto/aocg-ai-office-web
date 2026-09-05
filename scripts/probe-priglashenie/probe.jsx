// ⚠️ ПРОБА ФОРМЫ ПРИГЛАШЕНИЯ. Проверяет то, что на экране НЕ ВИДНО:
// какой запрос ушёл на сервер. Замер прода 04.09.2026 — пять бессрочных
// ссылок из восьми и почта, потерянная кнопкой «Скопировать ссылку»
// (она слала `email: null`, и именное приглашение молча становилось
// предъявительским).
//
// Поэтому проба ЗАПОМИНАЕТ ТЕЛА ЗАПРОСОВ в `window.__ЗАПРОСЫ` — сценарий
// смотрит на них, а не на бодрый ответ сервера.
import { createRoot } from "react-dom/client";
import App from "../../src/App.jsx";

window.__роль = "admin";
// Что сервер ответит на создание: «ок» или отказ 400 (для проверки, что
// отказ доходит до человека словами сервера, а не глотается).
const ОТКАЗ = new URLSearchParams(location.search).get("otkaz") === "1";

window.__ЗАПРОСЫ = [];

const ОТВЕТЫ = {
  "/api/users/me": {
    id: 1,
    first_name: "Алексей",
    last_name: "Шукалович",
    email: "a@example.com",
    role: "admin",
    is_email_verified: true,
    consent_version: 1,
    consent_at: "2026-08-01T00:00:00Z",
    linked_providers: [],
  },
  "/api/users/": [
    { id: 1, first_name: "Алексей", last_name: "Шукалович", role: "admin" },
  ],
  "/api/receipts/": [],
  "/api/reports/": [],
  "/api/cards/": [],
  "/api/categories/": { groups: [] },
  "/api/organizations/me": { id: 1, name: "АОЦГ", tax_system: "usn_d" },
  "/api/notifications/": { unread: 0, items: [] },
  // Уже выпущенная ОБЩАЯ ссылка: у неё нет адресата, и понять, что с ней
  // происходит, можно только по сроку и счётчику переходов.
  "/api/invite/list": [
    {
      token: "obshaya",
      invite_url: "https://app.aocgai.ru/join/obshaya",
      role: "employee",
      email: null,
      first_name: "",
      last_name: "",
      sent_at: null,
      expires_at: "2026-09-06T12:00:00Z",
      max_uses: 5,
      uses_count: 2,
      статус: "приглашён, ожидает",
    },
  ],
};

const ответ = (status, тело) => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(тело),
  text: () => Promise.resolve(JSON.stringify(тело)),
});

window.fetch = (u, opts = {}) => {
  const путь = String(u)
    .replace(/^https?:\/\/[^/]+/, "")
    .split("?")[0];
  if (путь === "/api/invite/create") {
    const тело = JSON.parse(opts.body || "{}");
    window.__ЗАПРОСЫ.push(тело);
    if (ОТКАЗ)
      return Promise.resolve(
        ответ(400, {
          detail:
            "Укажите срок действия приглашения — бессрочных ссылок не бывает",
        }),
      );
    return Promise.resolve(
      ответ(200, {
        token: "novyi",
        invite_url: "https://app.aocgai.ru/join/novyi",
        // ⚠️ Сервер отвечает ролью ИЗ ЗАПИСАННОЙ СТРОКИ: у общей ссылки она
        // employee, что бы ни прислала форма (d376799).
        role: тело.email ? тело.role : "employee",
        max_uses: 1,
        expires_at: "2026-09-12T12:00:00Z",
        email: тело.email || null,
        first_name: тело.first_name || "",
        last_name: тело.last_name || "",
        sent_at: тело.email ? "2026-09-05T12:00:00Z" : null,
      }),
    );
  }
  return Promise.resolve(ответ(200, ОТВЕТЫ[путь] ?? []));
};

localStorage.setItem("access_token", "проба");
localStorage.setItem("refresh_token", "проба");
localStorage.setItem("consent_given", "true");
localStorage.setItem("consent_version", "1");

createRoot(document.getElementById("root")).render(<App />);
