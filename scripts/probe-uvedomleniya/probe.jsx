// ⚠️ ПРОБА КОЛОКОЛЬЧИКА (T159, блок В).
//
// ЗАЧЕМ. До 10.09.2026 у колокольчика не было прибора НИ ОДНОГО: каталогов
// проб восемнадцать, `check-*.mjs` тридцать семь, и ни один не касался
// уведомлений. Восемь упоминаний `/api/notifications/` в чужих пробах —
// это ГЛУШИТЕЛЬ `{unread: 0, items: []}`, чтобы соседний экран не падал;
// ни одного утверждения о самом колокольчике.
//
// ⚠️ ЧЕТЫРЕ СЛУЧАЯ, И КАЖДЫЙ ЛОВИТ СВОЁ:
//   `pusto`  — событий нет: точки НЕТ, и сказано словами, а не пустотой;
//   `est`    — два непрочитанных: точка ЕСТЬ, открытие её гасит и шлёт POST;
//   `otkaz`  — сервер отказал: сказано об ОТКАЗЕ, а не «Пока ничего нового».
//              Этой ветки в `probe-otkaz-zagruzki` нет — `/api/notifications/`
//              не входит в её список падающих, и дыра унаследовалась бы,
//              если копировать бездумно;
//   `prochit` — всё прочитано: точки нет, но открытие ВСЁ РАВНО перечитывает
//              список (POST при этом не шлётся — гасить нечего).
import { createRoot } from "react-dom/client";
import App from "../../src/App.jsx";

const СЛУЧАЙ = new URLSearchParams(location.search).get("sluchay") || "est";

const СОБЫТИЯ = [
  {
    id: 1,
    kind: "report_rejected",
    title: "Отчёт отклонён: Отчёт за май",
    body: "нет чека на 1200 ₽",
    report_id: 7,
    created_at: "2026-09-10T10:00:00Z",
    read: false,
  },
  {
    id: 2,
    kind: "invite_accepted",
    title: "Новый сотрудник: Пётр Сидоров",
    body: "Завёл учётную запись по приглашению",
    // ⚠️ У ЭТОГО СОБЫТИЯ report_id ПУСТОЙ, и это не забывчивость: вести
    // из него некуда. Строка обязана остаться некликабельной — мёртвая
    // кнопка хуже её отсутствия.
    report_id: null,
    created_at: "2026-09-10T09:00:00Z",
    read: false,
  },
];

const УВЕДОМЛЕНИЯ = {
  pusto: { unread: 0, items: [] },
  est: { unread: 2, items: СОБЫТИЯ },
  prochit: { unread: 0, items: СОБЫТИЯ.map((с) => ({ ...с, read: true })) },
};

// Счётчик POST /read — сторож смотрит его через видимый след на экране,
// но и в самой пробе он нужен: без него «гасим» неотличимо от «не шлём».
window.__ПОСТОВ = 0;
window.__ТЕЛО = null;

// ⚠️ ЗАГЛУШКА ДЕРЖИТ СОСТОЯНИЕ, А НЕ ОТВЕЧАЕТ ОДНО И ТО ЖЕ. Первая
// редакция возвращала `unread: 2` и ПОСЛЕ гашения — точка возвращалась
// на перечитывании, и сторож краснел на исправном коде. Настоящий сервер
// после `POST /read` отдаёт ноль (`app/routers/notifications.py:66-70`),
// и заглушка обязана вести себя так же: иначе она проверяет не приложение,
// а собственную забывчивость.
let погашено = false;

const ОТВЕТЫ = {
  "/api/users/me": {
    id: 1,
    first_name: "Алексей",
    last_name: "Шукалович",
    email: "u@example.com",
    role: "admin",
    is_email_verified: true,
    consent_version: 1,
    consent_at: "2026-08-01T00:00:00Z",
    linked_providers: [],
  },
  "/api/users/": [{ id: 1, first_name: "Алексей", last_name: "Шукалович" }],
  "/api/receipts/": [],
  "/api/reports/": [],
  "/api/cards/": [],
  "/api/categories/": { groups: [] },
  "/api/organizations/me": { id: 1, name: "АОЦГ", tax_system: "usn_d" },
  "/api/invite/list": [],
  "/api/services/": [],
};

const ответ = (status, тело) => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(тело),
  text: () => Promise.resolve(JSON.stringify(тело)),
});

window.fetch = (u, opts) => {
  const путь = String(u)
    .replace(/^https?:\/\/[^/]+/, "")
    .split("?")[0];
  if (путь === "/api/notifications/read") {
    window.__ПОСТОВ += 1;
    // ⚠️ ЗАПОМИНАЕМ ТЕЛО: с 10.09.2026 клиент обязан прислать id того,
    // что нарисовал. Пустое тело сервер понимает («погаси первые двадцать»),
    // но это запасной путь для стороннего вызова — наш экран знает точно,
    // и молчаливый возврат к «погаси всё» был бы потерей уведомлений.
    try {
      window.__ТЕЛО = JSON.parse((opts && opts.body) || "null");
    } catch {
      window.__ТЕЛО = "НЕ РАЗОБРАЛОСЬ";
    }
    погашено = true;
    return Promise.resolve(ответ(200, { read: 2 }));
  }
  if (путь === "/api/notifications/") {
    if (СЛУЧАЙ === "otkaz")
      return Promise.resolve(ответ(500, { detail: "ой" }));
    const д = УВЕДОМЛЕНИЯ[СЛУЧАЙ] ?? УВЕДОМЛЕНИЯ.est;
    if (!погашено) return Promise.resolve(ответ(200, д));
    return Promise.resolve(
      ответ(200, {
        unread: 0,
        items: д.items.map((с) => ({ ...с, read: true })),
      }),
    );
  }
  if (opts && String(opts.method || "GET").toUpperCase() !== "GET")
    return Promise.resolve(ответ(200, {}));
  return Promise.resolve(ответ(200, ОТВЕТЫ[путь] ?? []));
};

localStorage.setItem("access_token", "проба");
localStorage.setItem("refresh_token", "проба");
localStorage.setItem("consent_given", "true");
localStorage.setItem("consent_version", "1");

createRoot(document.getElementById("root")).render(<App />);
