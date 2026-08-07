/**
 * СТЕНД СОГЛАСИЯ — ворота повторного сбора и загрузка текста (строка 9, S-34).
 *
 * ЗАЧЕМ. Экран согласия показывается по СЕРВЕРНОЙ редакции: если запись
 * пользователя отстала от действующей версии политики, экран появляется снова.
 * Проверить это на живых данных нельзя (нужны разные состояния записи),
 * поэтому роль сервера играет подмена `window.fetch` — тем же способом, что
 * в `tools/role-stand.mjs` (там же разобрано, почему не `page.route`).
 *
 * ТРИ СЛУЧАЯ, и все три нужны: только вместе они отличают «ворота работают»
 * от «экран показывается всегда» и от «экран не показывается никогда».
 *
 * ЗАПУСК:
 *   npm run build
 *   npx vite preview --port 4180 --strictPort &
 *   node tools/consent-stand.mjs
 */
import { chromium } from "./layout-audit/node_modules/playwright/index.mjs";

const BASE = process.env.BASE || "http://localhost:4180";
const ДЕЙСТВУЮЩАЯ = "1.0";
const ТЕКСТ = "Согласие на обработку персональных данных. Anthropic PBC (США).";

async function прогон({ версияЗаписи, флагВБраузере }) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await page.addInitScript(
    ([текст, действующая, верс, флаг]) => {
      localStorage.setItem("access_token", "фиктивный-для-стенда");
      if (флаг) localStorage.setItem("consent_given", "true");
      else localStorage.removeItem("consent_given");
      window.__моки = 0;
      const настоящий = window.fetch;
      window.fetch = (вход, опции) => {
        const url = typeof вход === "string" ? вход : (вход && вход.url) || "";
        const path = url.startsWith("http") ? new URL(url).pathname : url;
        if (!path.startsWith("/api/")) return настоящий(вход, опции);
        window.__моки++;
        const json = (тело) =>
          Promise.resolve(
            new Response(JSON.stringify(тело), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        if (path === "/api/consent/policy")
          return json({
            version: действующая,
            text: текст,
            // S-36: политика приходит той же ручкой — без неё
            // загрузка считается неполной и экран не пустит дальше.
            policy: "## Политика\n\nтекст политики для стенда",
          });
        if (path === "/api/users/me")
          return json({
            id: 1,
            role: "admin",
            consent: верс
              ? { policy_version: верс, given_at: "2026-05-20" }
              : null,
          });
        return json(path.endsWith("/") ? [] : {});
      };
    },
    [ТЕКСТ, ДЕЙСТВУЮЩАЯ, версияЗаписи, флагВБраузере],
  );

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  // Ворота стенда: без подмен «экрана нет» означало бы сломанный стенд.
  const моки = await page.evaluate(() => window.__моки || 0);
  if (моки < 1) throw new Error(`моки не применились (подмен ${моки})`);

  const тело = await page.evaluate(() => document.body.innerText);
  await browser.close();
  return {
    экранСогласия: тело.includes("ознакомьтесь с документами"),
    объяснение: тело.includes("Мы обновили текст согласия"),
  };
}

const ОЖИДАНИЕ = [
  {
    случай: `запись ${ДЕЙСТВУЮЩАЯ} (актуальная)`,
    вход: { версияЗаписи: ДЕЙСТВУЮЩАЯ, флагВБраузере: true },
    ждём: { экранСогласия: false, объяснение: false },
  },
  {
    случай: "запись 0.9 (отстала)",
    вход: { версияЗаписи: "0.9", флагВБраузере: true },
    // Объяснения НЕТ намеренно: журнал очищен 07.08.2026, для всех это
    // первый раз. Механика ворот останется нужной при смене редакции.
    ждём: { экранСогласия: true, объяснение: false },
  },
  {
    случай: "согласия нет вовсе",
    вход: { версияЗаписи: null, флагВБраузере: false },
    ждём: { экранСогласия: true, объяснение: false },
  },
];

const итог = [];
for (const { случай, вход, ждём } of ОЖИДАНИЕ) {
  const факт = await прогон(вход);
  итог.push({ случай, ...факт });
  for (const [ключ, значение] of Object.entries(ждём)) {
    if (факт[ключ] !== значение) {
      console.table(итог);
      console.log(
        `✗ ${случай}: ${ключ} = ${факт[ключ]}, ожидалось ${значение}`,
      );
      process.exit(1);
    }
  }
}
console.table(итог);
console.log(
  "✓ ворота согласия: отставшая редакция показывает экран, актуальная — нет",
);

/**
 * ВТОРАЯ ПОЛОВИНА СТЕНДА — ДОКУМЕНТЫ ЮРИСТА В ШТОРКЕ (S-36).
 *
 * Ворота выше проверяют, ПОКАЗЫВАЕТСЯ ли экран. Здесь — ЧИТАЕМ ли документ,
 * который на нём принимают. Это не косметика: согласие даётся на полный текст,
 * и таблица правовых оснований, вывалившаяся палками, — дефект юридический,
 * а не оформительский.
 *
 * ГОНЯЕМ НАСТОЯЩИЕ ФАЙЛЫ ЮРИСТА, а не образец: выдуманный markdown проверяет
 * рендер, но не проверяет ЭТИ документы. Первый прогон именно так и нашёл
 * дефект — react-markdown без remark-gfm выдал 0 таблиц из 24 строк.
 */
const ДОКИ =
  process.env.LEGAL_DIR ||
  new URL("../../aocg-ai-office/docs/", import.meta.url).pathname;
const { readFileSync } = await import("node:fs");
let согласиеТекст, политикаТекст;
try {
  согласиеТекст = readFileSync(
    `${ДОКИ}AOCG-LEGAL-002-Soglasie_PD_v2.0.md`,
    "utf8",
  );
  политикаТекст = readFileSync(
    `${ДОКИ}AOCG-LEGAL-003-Politika_v2.0.md`,
    "utf8",
  );
} catch (e) {
  // Пропуск молча означал бы «проверено», а проверено ничего. Падаем.
  console.log(`✗ файлы юриста не прочитаны (${ДОКИ}): ${e.message}`);
  process.exit(1);
}
const ТАБЛИЧНЫХ =
  (согласиеТекст.match(/^\|/gm) || []).length +
  (политикаТекст.match(/^\|/gm) || []).length;
if (ТАБЛИЧНЫХ < 10) {
  console.log(`✗ в документах ${ТАБЛИЧНЫХ} табличных строк — проверять нечего`);
  process.exit(1);
}

async function прогонДокумента({ ссылка, текст }) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await page.addInitScript(
    ([сог, пол]) => {
      localStorage.setItem("access_token", "фиктивный-для-стенда");
      localStorage.removeItem("consent_given");
      window.__моки = 0;
      const настоящий = window.fetch;
      window.fetch = (вход, опции) => {
        const url = typeof вход === "string" ? вход : (вход && вход.url) || "";
        const path = url.startsWith("http") ? new URL(url).pathname : url;
        if (!path.startsWith("/api/")) return настоящий(вход, опции);
        window.__моки++;
        const json = (тело) =>
          Promise.resolve(
            new Response(JSON.stringify(тело), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        if (path === "/api/consent/policy")
          return json({ version: "2.0", text: сог, policy: пол });
        if (path === "/api/users/me") return json({ id: 1, role: "admin" });
        return json(path.endsWith("/") ? [] : {});
      };
    },
    [согласиеТекст, политикаТекст],
  );
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const моки = await page.evaluate(() => window.__моки || 0);
  if (моки < 1) throw new Error(`моки не применились (подмен ${моки})`);

  await page.evaluate((подпись) => {
    const узел = [...document.querySelectorAll("span")].find((э) =>
      э.textContent.includes(подпись),
    );
    if (узел) узел.click();
  }, ссылка);
  await page.waitForTimeout(500);

  const факт = await page.evaluate((кусок) => {
    const д = document.querySelector('[role="dialog"]');
    if (!д) return null;
    return {
      таблиц: д.querySelectorAll("table").length,
      строкТаблиц: д.querySelectorAll("tr").length,
      // Палки и дефисы на экране = markdown не разобран.
      сыраяРазметка: /\|\s*-{3}/.test(д.innerText),
      // ВБОК ИМЕЕТ ПРАВО ЕХАТЬ ТОЛЬКО ТАБЛИЦА, И ТОЛЬКО В СВОЁМ КОНТЕЙНЕРЕ.
      // Мерить корень шторки бесполезно: у документа свой контейнер с
      // `overflow: auto`, и он молча принимает боковую прокрутку на себя —
      // мутация «убрать обёртку таблицы» так и осталась незамеченной первым
      // вариантом проверки. Поэтому ищем ВСЕ узлы, которые едут вбок, и
      // прощаем только обёртку таблицы (прямой ребёнок <table> + свой скролл).
      чужаяПрокрутка: [д, ...д.querySelectorAll("*")].filter((э) => {
        if (э.scrollWidth <= э.clientWidth + 1) return false;
        const свой = getComputedStyle(э).overflowX;
        const обёрткаТаблицы =
          э.querySelector(":scope > table") &&
          (свой === "auto" || свой === "scroll");
        return !обёрткаТаблицы;
      }).length,
      текстНаМесте: д.innerText.includes(кусок),
    };
  }, текст);
  await browser.close();
  return факт;
}

const ДОКУМЕНТЫ = [
  {
    случай: "согласие 2.0 в шторке",
    ссылка: "согласие на обработку моих персональных данных",
    // Клаузула о кассире — та, ради которой сверялась редакция 2.0.
    текст: "кассире",
  },
  {
    случай: "политика 2.0 в шторке",
    ссылка: "Политикой конфиденциальности",
    текст: "Роскомнадзор",
  },
];

const итогДок = [];
for (const { случай, ссылка, текст } of ДОКУМЕНТЫ) {
  const факт = await прогонДокумента({ ссылка, текст });
  if (!факт) {
    console.log(`✗ ${случай}: шторка не открылась`);
    process.exit(1);
  }
  итогДок.push({ случай, ...факт });
  const беда =
    факт.таблиц < 1 ||
    факт.сыраяРазметка ||
    факт.чужаяПрокрутка > 0 ||
    !факт.текстНаМесте;
  if (беда) {
    console.table(итогДок);
    console.log(`✗ ${случай}: документ отрисован неверно`);
    process.exit(1);
  }
}
console.table(итогДок);
console.log(
  `✓ документы юриста: markdown разобран, ${ТАБЛИЧНЫХ} табличных строк не палками, шторка не едет вбок`,
);
