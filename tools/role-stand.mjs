/**
 * СТЕНД РОЛЕЙ — проверка ролевых гейтов интерфейса без живых учёток и без прода.
 *
 * ЗАЧЕМ. Гейт «этого не видит сотрудник» проверяется только сравнением ролей
 * между собой: одна роль ничего не доказывает — пустой экран и работающий
 * гейт выглядят одинаково. Живых учёток сотрудника и бухгалтера у нас нет,
 * заводить их ради проверки дорого, поэтому роль подменяется в ответе
 * `/api/users/me` на локально собранном `dist`.
 *
 * ЗАПУСК:
 *   npm run build
 *   npx vite preview --port 4180 --strictPort &
 *   node tools/role-stand.mjs
 *
 * ДВА ГРАБЛЯ, КУПЛЕННЫЕ ЗДЕСЬ 07.08.2026 — не наступать снова:
 *
 * 1. `page.route()` НЕ ВИДИТ ЗАПРОСОВ ПРИЛОЖЕНИЯ в этой среде. Ручной
 *    `fetch` из `page.evaluate` он перехватывает, а вызовы из бандла — нет
 *    (проверено: подменённый `window.fetch` печатает семь обращений, ни одно
 *    не доходит до обработчика route, включая `context.route("**\/*")`).
 *    Мок молча не применялся, все три роли давали одинаковый ПУСТОЙ результат,
 *    и это читалось как «гейт работает». Поэтому подмена — на уровне
 *    `window.fetch`, а число подмен возвращается в отчёт и проверяется:
 *    мало подмен → стенд не поднялся → замер НЕ засчитывается.
 *
 * 2. `innerText` отдаёт РЕНДЕРНЫЙ регистр. Заголовок секции набран через
 *    `text-transform`, и в тексте он «СОТРУДНИК», а не «Сотрудник». Точное
 *    сравнение давало «секции нет» у ВСЕХ ролей при работающем показе —
 *    снова ложный успех гейта. Сравнение регистронезависимое.
 *
 * Родня по смыслу: правило «измеритель — такой же сторож» в CLAUDE.md
 * и `tools/layout-audit/probe.mjs` (там та же логика для замеров вёрстки).
 */
import { chromium } from "./layout-audit/node_modules/playwright/index.mjs";

const BASE = process.env.BASE || "http://localhost:4180";
const СЕГОДНЯ = new Date().toISOString().slice(0, 10);

// Ответы бэкенда для стенда. Роль подставляется в /api/users/me — это
// единственное, что отличает прогоны друг от друга.
const апи = (role) => ({
  "/api/users/me": { id: 1, role, first_name: "Тест", last_name: "Тестов" },
  "/api/users/": [
    { id: 1, first_name: "Тест", last_name: "Тестов" },
    { id: 2, first_name: "Иван", last_name: "Петров" },
  ],
  "/api/cards/": [{ id: 1, name: "Корп.карта", is_default: true }],
  "/api/organizations/me": { id: 1, name: "ООО Ромашка" },
  "/api/receipts/": [
    {
      id: 1,
      date: СЕГОДНЯ,
      org: "Лукойл",
      payment: "Корп.карта",
      amount: 1520,
      employee: "Тест Тестов",
      category_id: null,
      source: "manual",
      user_id: 1,
    },
  ],
  "/api/reports/": [],
  "/api/services/": [],
  "/api/invite/list": [],
  "/api/categories/": { groups: [] },
});

async function прогон(role) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });

  await page.addInitScript((карта) => {
    localStorage.setItem("consent_given", "true");
    localStorage.setItem("access_token", "фиктивный-для-стенда");
    window.__моки = 0;
    const настоящий = window.fetch;
    window.fetch = (вход, опции) => {
      const url = typeof вход === "string" ? вход : (вход && вход.url) || "";
      const path = url.startsWith("http") ? new URL(url).pathname : url;
      if (path.startsWith("/api/")) {
        window.__моки++;
        const тело = карта[path] ?? (path.endsWith("/") ? [] : {});
        return Promise.resolve(
          new Response(JSON.stringify(тело), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return настоящий(вход, опции);
    };
  }, апи(role));

  await page.goto(BASE, { waitUntil: "networkidle" });

  // ВОРОТА СТЕНДА. Без них нули читаются как результат.
  const моки = await page.evaluate(() => window.__моки || 0);
  if (моки < 5)
    throw new Error(
      `моки не применились (роль ${role}): подмен fetch всего ${моки}. ` +
        "Стенд не поднялся — замер не считается.",
    );
  if (!(await page.evaluate(() => document.body.innerText.includes("Сводка"))))
    throw new Error(
      `приложение не открылось (роль ${role}): в теле нет «Сводка»`,
    );

  const клик = (текст) =>
    page.evaluate((t) => {
      const n = [...document.querySelectorAll("span,div,button")].find(
        (e) => e.textContent.trim() === t && e.children.length === 0,
      );
      if (n) (n.closest("button") || n).click();
      return !!n;
    }, текст);

  // ── «Сводка» → фильтры: есть ли секция выбора сотрудника
  if (!(await клик("Сводка"))) throw new Error("пункт меню «Сводка» не найден");
  await page.waitForTimeout(800);
  const кнопка = page.locator('button[aria-label="Фильтры"]').first();
  if ((await кнопка.count()) === 0)
    throw new Error("кнопка фильтров на «Сводке» не найдена");
  await кнопка.click();
  await page.waitForTimeout(600);
  const модалка = page.locator('[role="dialog"][aria-label="Фильтры"]').first();
  if ((await модалка.count()) === 0)
    throw new Error("модалка фильтров не открылась");
  const секцияСотрудник = /(^|\n)сотрудник(\n|$)/i.test(
    await модалка.innerText(),
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // ── «Настройки» (круглая кнопка аккаунта в шапке, из таб-бара убраны)
  await page.locator('button[aria-label="Аккаунт"]').first().click();
  await page.waitForTimeout(900);
  const ВСЕ = [
    "Аккаунт",
    "Организация",
    "Лицензии",
    "Пользователи",
    "Сервисы",
    "Общие",
  ];
  const вкладки = await page.evaluate(
    (ВСЕ) =>
      [...document.querySelectorAll("button")]
        .map((b) => b.textContent.trim())
        .filter((t) => ВСЕ.includes(t)),
    ВСЕ,
  );
  if (!вкладки.includes("Аккаунт"))
    throw new Error("вкладки Настроек не найдены — экран не открылся");

  await browser.close();
  return {
    role,
    секцияСотрудник,
    вкладкаПользователи: вкладки.includes("Пользователи"),
    вкладки: вкладки.join(" · "),
  };
}

// Ожидание записано ЯВНО и по каждой роли: «сотрудник не видит» без «админ
// видит» не отличает гейт от сломанного экрана.
const ОЖИДАНИЕ = {
  employee: { секцияСотрудник: false, вкладкаПользователи: false },
  accountant: { секцияСотрудник: true, вкладкаПользователи: false },
  admin: { секцияСотрудник: true, вкладкаПользователи: true },
};

const итог = [];
for (const role of Object.keys(ОЖИДАНИЕ)) итог.push(await прогон(role));
console.table(итог);

const расхождения = итог.flatMap((r) =>
  Object.entries(ОЖИДАНИЕ[r.role])
    .filter(([k, v]) => r[k] !== v)
    .map(([k, v]) => `${r.role}: ${k} = ${r[k]}, ожидалось ${v}`),
);
if (расхождения.length) {
  console.log("✗ РАСХОЖДЕНИЯ:\n  " + расхождения.join("\n  "));
  process.exit(1);
}
console.log(
  "✓ ролевые гейты сошлись: сотрудник не видит ни фильтра по сотруднику, " +
    "ни вкладки «Пользователи»; бухгалтер видит фильтр, но не вкладку; админ видит всё",
);
