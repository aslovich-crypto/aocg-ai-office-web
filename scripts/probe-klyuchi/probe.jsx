// ⚠️ ПРОБА БЛОКА «КЛЮЧИ ДОСТУПА» на экране «Интеграции» (шаг 3, заход ⑧).
//
// ЗАЧЕМ ПРОГОН ПО ЭКРАНУ, А НЕ ЧТЕНИЕ ИСХОДНИКА. Всё, что здесь проверяется,
// имеет наблюдаемое следствие: видна ли кнопка выпуска бухгалтеру, стоит ли
// предупреждение ДО нажатия, показан ли секрет один раз и исчезает ли он.
// Сторож, читающий исходник, сказал бы «условие написано» — и промолчал бы
// о том, что ветка не срабатывает (граница из правил фронта, случай
// check-logout-return).
//
// Случаи, каждый своим адресом:
//   (без параметра)    — администратор, живой и отозванный ключ
//   ?sluchay=buhgalter — бухгалтер: список видит, кнопок нет
//   ?sluchay=sotrudnik — сотрудник: блока нет вовсе
//   ?sluchay=vypusk    — выпуск ключа: секрет показан один раз
//   ?sluchay=sboy      — список не загрузился (это НЕ «ключей нет»)
//   ?sluchay=predel    — третий живой ключ: отказ сервера слышен
//   ?sluchay=otozvan   — отзыв ключа, который уже отозвали: 404 — исход, не ошибка
import { createRoot } from "react-dom/client";
import App from "../../src/App.jsx";

const СЛУЧАЙ = new URLSearchParams(location.search).get("sluchay") || "";
const РОЛЬ =
  СЛУЧАЙ === "buhgalter"
    ? "accountant"
    : СЛУЧАЙ === "sotrudnik"
      ? "employee"
      : "admin";

const КЛЮЧ_ЦЕЛИКОМ = "aocgaabbccdd.SEKRET-POKAZAN-ODIN-RAZ";

const КЛЮЧИ = [
  {
    id: 1,
    prefix: "aocgaabbccdd",
    name: "1С бюро",
    created_at: "2026-09-01T10:00:00Z",
    expires_at: "2027-09-01T10:00:00Z",
    last_used_at: "2026-09-12T08:00:00Z",
    use_count: 17,
    revoked_at: null,
    days_left: 353,
    is_active: true,
  },
  {
    id: 2,
    prefix: "aocg11223344",
    name: "Старый ключ",
    created_at: "2026-06-01T10:00:00Z",
    expires_at: "2027-06-01T10:00:00Z",
    last_used_at: null,
    use_count: 0,
    revoked_at: "2026-08-20T10:00:00Z",
    days_left: 260,
    is_active: false,
  },
];

const ОТВЕТЫ = {
  "/api/users/me": {
    id: 1,
    first_name: "Алексей",
    last_name: "Шукалович",
    email: "a@example.com",
    role: РОЛЬ,
    is_email_verified: true,
    consent_version: 1,
    consent_at: "2026-08-01T00:00:00Z",
    linked_providers: [],
  },
  "/api/users/": [
    { id: 1, first_name: "Алексей", last_name: "Шукалович", role: РОЛЬ },
  ],
  "/api/receipts/": [],
  "/api/reports/": [],
  "/api/cards/": [],
  "/api/categories/": { groups: [] },
  "/api/organizations/me": { id: 1, name: "АОЦГ", tax_system: "usn_d" },
  "/api/notifications/": { unread: 0, items: [] },
  "/api/services/": [],
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
  if (путь === "/api/integration-keys/") {
    if ((opts.method || "GET") === "POST") {
      // ⚠️ ТРЕТИЙ ЖИВОЙ КЛЮЧ — ОТКАЗ СЕРВЕРА, А НЕ МОЛЧАНИЕ: человек обязан
      // узнать, почему ключа нет, иначе он нажмёт ещё раз.
      if (СЛУЧАЙ === "predel")
        return Promise.resolve(
          ответ(409, {
            detail: "Живых ключей уже 2. Отзовите ненужный и выпустите новый.",
          }),
        );
      return Promise.resolve(
        ответ(200, { ...КЛЮЧИ[0], id: 3, name: "Новый", key: КЛЮЧ_ЦЕЛИКОМ }),
      );
    }
    if (СЛУЧАЙ === "sboy") return Promise.reject(new Error("нет связи"));
    return Promise.resolve(ответ(200, КЛЮЧИ));
  }
  if (путь === "/api/integration-keys/1/revoke") {
    // ⚠️ КЛЮЧ УЖЕ ОТОЗВАН С ДРУГОГО УСТРОЙСТВА: бэкенд отвечает 404 —
    // тем же, что на чужой и на несуществующий. Экран обязан прочесть это
    // как «уже отозван», а не как поломку.
    if (СЛУЧАЙ === "otozvan")
      return Promise.resolve(ответ(404, { detail: "Not found" }));
    return Promise.resolve(
      ответ(200, {
        ...КЛЮЧИ[0],
        revoked_at: "2026-09-13T10:00:00Z",
        is_active: false,
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
