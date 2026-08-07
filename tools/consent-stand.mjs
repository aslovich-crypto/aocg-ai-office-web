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
          return json({ version: действующая, text: текст });
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
