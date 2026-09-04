// ⚠️ ПРОБА АВТОРА ЧЕКА. Проверяет то, чего НЕ ВИДНО на живых данных:
// у всех 88 чеков прода `user_id` = 1, поэтому после правки экран почти
// не меняется, и «посмотрел глазами» здесь ничего не доказывает (слово
// владельца 04.09.2026). Здесь данные ДВУХ авторов и третий чек без автора.
//
// Ответы подставлены намеренно: проверяется РАЗБОР и ПОКАЗ на фронте,
// а не путь до базы — его проверяет сквозная проба (npm run skvoz).
import { createRoot } from "react-dom/client";
import App from "../../src/App.jsx";

const РОЛЬ = new URLSearchParams(location.search).get("rol") || "admin";
// Роль кладём в окно: сценарий печатает её в замер, иначе «подписи видны»
// не отличить от «роль не доехала».
window.__роль = РОЛЬ;

const ЛЮДИ = [
  { id: 1, first_name: "Алексей", last_name: "Шукалович", role: "admin" },
  { id: 20, first_name: "Татьяна", last_name: "Иванова", role: "accountant" },
  // ⚠️ ЧЕЛОВЕК БЕЗ ЧЕКОВ — ради главного утверждения: выбор такого сотрудника
  // обязан дать ПУСТО. До правки он давал пустоту всегда, независимо от
  // данных, — и отличить «работает» от «сломано» было нельзя.
  { id: 33, first_name: "Пустой", last_name: "Человек", role: "employee" },
];

// Три чека: два разных автора и один «ничей» (старая строка без user_id).
const ЧЕКИ = [
  {
    id: 101,
    org: "Кофейня",
    amount: 450,
    date: "2026-09-01",
    payment: "Корп.карта",
    user_id: 1,
    employee: null,
    category_id: null,
  },
  {
    id: 102,
    org: "Канцтовары",
    amount: 780,
    date: "2026-09-02",
    payment: "Корп.карта",
    user_id: 20,
    employee: null,
    category_id: null,
  },
  {
    id: 103,
    org: "Такси",
    amount: 300,
    date: "2026-09-03",
    payment: "Наличные",
    user_id: null,
    employee: null,
    category_id: null,
  },
];

const ОТВЕТЫ = {
  "/api/users/me": {
    id: РОЛЬ === "employee" ? 20 : 1,
    first_name: РОЛЬ === "employee" ? "Татьяна" : "Алексей",
    last_name: РОЛЬ === "employee" ? "Иванова" : "Шукалович",
    email: "u@example.com",
    role: РОЛЬ,
    is_email_verified: true,
    consent_version: 1,
    consent_at: "2026-08-01T00:00:00Z",
    linked_providers: [],
  },
  "/api/users/": ЛЮДИ,
  "/api/receipts/": ЧЕКИ,
  "/api/reports/": [],
  "/api/cards/": [{ id: 1, name: "Корп.карта", is_default: true }],
  "/api/categories/": { groups: [] },
  "/api/organizations/me": { id: 1, name: "АОЦГ", tax_system: "usn_d" },
  "/api/notifications/": { unread: 0, items: [] },
};

window.fetch = (u) => {
  const путь = String(u)
    .replace(/^https?:\/\/[^/]+/, "")
    .split("?")[0];
  const тело = ОТВЕТЫ[путь] ?? [];
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(тело),
    text: () => Promise.resolve(JSON.stringify(тело)),
  });
};

localStorage.setItem("access_token", "проба");
localStorage.setItem("refresh_token", "проба");
localStorage.setItem("consent_given", "true");
localStorage.setItem("consent_version", "1");

createRoot(document.getElementById("root")).render(<App />);
