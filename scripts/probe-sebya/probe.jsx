// ⚠️ ПРОБА ПОДТВЕРЖДЕНИЯ «ВЫ ТЕРЯЕТЕ ДОСТУП СРАЗУ» (T137).
//
// ЗАЧЕМ ПРОГОН ПО ЭКРАНУ, А НЕ ЧТЕНИЕ ИСХОДНИКА. Предмет проверки —
// СРАБАТЫВАЕТ ли условие, а не написано ли оно. Сторож, читающий исходник,
// увидел бы `u.id === me?.id` и сказал «условие на месте» — и промолчал бы
// о том, что `me` не доезжает до экрана и условие ложно всегда. Ровно этот
// класс уже стоил нам `onUpdateUser`, который молча выбрасывался с 13.06.2026.
//
// ⚠️ ЖМЁМ ПО ЭЛЕМЕНТУ ДЕЙСТВИЯ, А НЕ ИМИТИРУЕМ ПАЛЕЦ. Красная «Удалить»
// лежит в разметке всегда (`SwipeableUserRow`), свайп только сдвигает
// карточку и открывает её. Клик по ней — ровно то, что делает палец после
// свайпа; имитация жеста добавила бы пробе собственную механику, которую
// пришлось бы проверять отдельно.
//
// Случаи, каждый своим адресом:
//   (без параметра)      — трое админов: я и двое; гашение СЕБЯ
//   ?sluchay=chuzhoy     — гашение ЧУЖОГО: спрашивать нельзя
//   ?sluchay=rol         — понижение СЕБЯ из админов
//   ?sluchay=rol-chuzhoy — понижение ЧУЖОГО: спрашивать нельзя
//   ?sluchay=odin        — я единственный админ: спрашивать некого
//   ?sluchay=mnogo       — пятеро админов: имена обрезаются счётом
import { createRoot } from "react-dom/client";
import App from "../../src/App.jsx";

const СЛУЧАЙ = new URLSearchParams(location.search).get("sluchay") || "";

const Я = {
  id: 1,
  first_name: "Алексей",
  last_name: "Шукалович",
  email: "a@example.com",
  role: "admin",
  is_active: true,
  is_email_verified: true,
};
const ДРУГИЕ_АДМИНЫ = [
  { id: 2, first_name: "Пётр", last_name: "Петров", role: "admin" },
  { id: 3, first_name: "Сергей", last_name: "Сидоров", role: "admin" },
  { id: 4, first_name: "Илья", last_name: "Кузнецов", role: "admin" },
  { id: 5, first_name: "Анна", last_name: "Николаева", role: "admin" },
];
const СОТРУДНИК = {
  id: 9,
  first_name: "Иван",
  last_name: "Рядовой",
  role: "employee",
  is_active: true,
};

// Сколько ДРУГИХ активных администраторов в организации.
const СКОЛЬКО_ДРУГИХ = СЛУЧАЙ === "odin" ? 0 : СЛУЧАЙ === "mnogo" ? 4 : 2;

const ЛЮДИ = [
  Я,
  ...ДРУГИЕ_АДМИНЫ.slice(0, СКОЛЬКО_ДРУГИХ).map((у) => ({
    ...у,
    is_active: true,
    email: `u${у.id}@example.com`,
  })),
  СОТРУДНИК,
];

// Куда ушёл запрос — это и есть «действие выполнено без вопроса».
window.__УШЛО = [];

const ОТВЕТЫ = {
  "/api/users/me": {
    ...Я,
    consent_version: 1,
    consent_at: "2026-08-01T00:00:00Z",
    linked_providers: [],
  },
  "/api/users/": ЛЮДИ,
  "/api/receipts/": [],
  "/api/reports/": [],
  "/api/cards/": [],
  "/api/categories/": { groups: [] },
  "/api/organizations/me": { id: 1, name: "АОЦГ", tax_system: "usn_d" },
  "/api/notifications/": { unread: 0, items: [] },
  "/api/services/": [],
  "/api/invite/list": [],
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

  if (/^\/api\/users\/\d+$/.test(путь) && метод !== "GET") {
    window.__УШЛО.push(`${метод} ${путь}`);
    const id = Number(путь.split("/").pop());
    if (метод === "DELETE") return Promise.resolve(ответ(200, { ok: true }));
    // ⚠️ ПОНИЖЕНИЕ ПОСЛЕДНЕГО АДМИНА ОТВЕРГАЕТ СЕРВЕР, и проба обязана это
    // изображать: на случае `odin` окна нет именно потому, что действие
    // не состоится, а причину называет сервер.
    if (СКОЛЬКО_ДРУГИХ === 0 && id === Я.id)
      return Promise.resolve(
        ответ(409, {
          detail:
            "Вы единственный администратор организации — сначала пригласите второго администратора, иначе организацию будет некому вести",
        }),
      );
    const тело = JSON.parse(opts.body || "{}");
    return Promise.resolve(
      ответ(200, { ...ЛЮДИ.find((ч) => ч.id === id), ...тело }),
    );
  }
  return Promise.resolve(ответ(200, ОТВЕТЫ[путь] ?? []));
};

localStorage.setItem("access_token", "проба");
localStorage.setItem("refresh_token", "проба");
localStorage.setItem("consent_given", "true");
localStorage.setItem("consent_version", "1");

createRoot(document.getElementById("root")).render(<App />);
