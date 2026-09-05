// ⚠️ ПРОБА УДАЛЕНИЯ ЧЕКА. Проверяет то, что на живых данных не отличить:
// сервер отвечает 200 `{"ok": true}` И когда чек удалён, И когда нет
// (анти-разведка, receipts.py:1009-1010). На экране разница была не видна —
// строка исчезала в обоих случаях, а чек возвращался после перезагрузки.
//
// Здесь четыре чека, и каждый — свой случай ответа сервера:
//   Такси      — удаляется по-настоящему (200, потом GET 404)
//   Канцтовары — 200 БЕЗ удаления (GET 200): чужой чек у бухгалтера
//   Кофейня    — лежит в отчёте (in_report), сервер ответил бы 409
//   Аптека     — 409 без признака in_report: сервер отказал, экран не знал
import { createRoot } from "react-dom/client";
import App from "../../src/App.jsx";

const РОЛЬ = new URLSearchParams(location.search).get("rol") || "accountant";
window.__роль = РОЛЬ;

const ЛЮДИ = [
  { id: 1, first_name: "Алексей", last_name: "Шукалович", role: "admin" },
  { id: 20, first_name: "Татьяна", last_name: "Иванова", role: "accountant" },
];

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
    in_report: true,
    report_id: 7,
    report_title: "Отчёт за май",
  },
  {
    id: 102,
    org: "Канцтовары",
    amount: 780,
    date: "2026-09-02",
    payment: "Корп.карта",
    user_id: 1,
    employee: null,
    category_id: null,
    in_report: false,
  },
  {
    id: 103,
    org: "Такси",
    amount: 300,
    date: "2026-09-03",
    payment: "Наличные",
    user_id: 20,
    employee: null,
    category_id: null,
    in_report: false,
  },
  {
    id: 104,
    org: "Аптека",
    amount: 120,
    date: "2026-09-04",
    payment: "Наличные",
    user_id: 20,
    employee: null,
    category_id: null,
    in_report: false,
  },
];

// Что сервер делает с каждым чеком: удалить по-настоящему, соврать 200,
// отказать 409. Признак «удалён» держим здесь — по нему отвечает и GET.
const УДАЛЁННЫЕ = new Set();
const ПОВЕДЕНИЕ = {
  101: "409", // в отчёте
  102: "200_молча", // ответ 200, чек остаётся
  103: "удаляется",
  104: "409", // отказ без in_report на карточке
};

const ОТВЕТЫ = {
  "/api/users/me": {
    id: РОЛЬ === "employee" ? 20 : 1,
    first_name: "Татьяна",
    last_name: "Иванова",
    email: "u@example.com",
    role: РОЛЬ,
    is_email_verified: true,
    consent_version: 1,
    consent_at: "2026-08-01T00:00:00Z",
    linked_providers: [],
  },
  "/api/users/": ЛЮДИ,
  "/api/reports/": [],
  "/api/cards/": [{ id: 1, name: "Корп.карта", is_default: true }],
  "/api/categories/": { groups: [] },
  "/api/organizations/me": { id: 1, name: "АОЦГ", tax_system: "usn_d" },
  "/api/notifications/": { unread: 0, items: [] },
};

const ответ = (status, тело) => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(тело),
  text: () => Promise.resolve(JSON.stringify(тело)),
});

window.fetch = (u, opts = {}) => {
  const метод = (opts.method || "GET").toUpperCase();
  const путь = String(u)
    .replace(/^https?:\/\/[^/]+/, "")
    .split("?")[0];
  const одиночный = путь.match(/^\/api\/receipts\/(\d+)$/);

  if (одиночный) {
    const id = Number(одиночный[1]);
    if (метод === "DELETE") {
      const как = ПОВЕДЕНИЕ[id];
      if (как === "409")
        return Promise.resolve(
          ответ(409, {
            detail:
              "Чек входит в отчёт «Отчёт за май» — сначала уберите его из отчёта, потом удаляйте",
          }),
        );
      if (как === "удаляется") УДАЛЁННЫЕ.add(id);
      // ⚠️ И в случае «удаляется», и в случае «200 молча» ответ ОДИН И ТОТ ЖЕ.
      return Promise.resolve(ответ(200, { ok: true }));
    }
    if (УДАЛЁННЫЕ.has(id))
      return Promise.resolve(ответ(404, { detail: "Not found" }));
    return Promise.resolve(ответ(200, ЧЕКИ.find((ч) => ч.id === id) || {}));
  }

  if (путь === "/api/receipts/")
    return Promise.resolve(
      ответ(
        200,
        ЧЕКИ.filter((ч) => !УДАЛЁННЫЕ.has(ч.id)),
      ),
    );

  return Promise.resolve(ответ(200, ОТВЕТЫ[путь] ?? []));
};

localStorage.setItem("access_token", "проба");
localStorage.setItem("refresh_token", "проба");
localStorage.setItem("consent_given", "true");
localStorage.setItem("consent_version", "1");

createRoot(document.getElementById("root")).render(<App />);
