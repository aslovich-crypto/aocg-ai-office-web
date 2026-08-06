#!/usr/bin/env node
// Самопроверка ветки «достижим прокруткой» в src/lib/overflowDebug.js (T21).
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ СТЕНД, А НЕ ПРОГОН ПО ПРОДУ. run.mjs ходит на выкаченный
// сайт: пока правка не задеплоена, проверить её там нельзя, а откладывать
// проверку до деплоя — это ровно та половинчатая мутация, которая уже стоила
// нам суток (правило T11). Здесь модуль диагностики поднимается в пустой
// странице с СИНТЕТИЧЕСКОЙ раскладкой: прода не нужно, зато нужен настоящий
// браузер — раскладки нет ни в Node, ни в jsdom.
//
// ЧТО ПРОВЕРЯЕТСЯ (два источника, оба сломаны мутацией при сдаче):
//   1. ГОЛОС. Элемент, до которого прокруткой НЕ добраться, обязан попасть
//      в группу «вылезли за экран». Проба ставится position:fixed — только
//      так она не расширяет прокручиваемую область предка (в потоке браузер
//      расширяет её мгновенно, и проверять становится нечего).
//   2. МОЛЧАНИЕ. Элемент внутри той же капсулы, до которого прокруткой
//      добраться МОЖНО, в отчёт попадать не должен. Без этой половины
//      «голос» доказывал бы лишь то, что сторож шумит на всё подряд.
//
// ГРАНИЦА. Стенд синтетический: он доказывает поведение ВЕТКИ, а не то, что
// на реальном экране нет других причин промолчать. Прогон по проду
// (run.mjs) этим не отменяется.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(ROOT, "src", "lib", "overflowDebug.js");

// Модуль — ESM с экспортами; в <script> его кладём как обычный код.
const source = readFileSync(SRC, "utf8").replace(/^export\s+/gm, "");

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0">
  <div style="width:100%;padding:12px">
    <!-- капсула фильтров: настоящий горизонтальный скроллер -->
    <div id="capsule" style="overflow-x:auto;white-space:nowrap;width:200px;border:1px solid #ccc">
      <span style="display:inline-block;width:120px">Неделя</span>
      <span style="display:inline-block;width:120px">Месяц</span>
      <span style="display:inline-block;width:120px" id="far">Квартал</span>
    </div>
  </div>
</body></html>`;

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.setViewportSize({ width: 375, height: 667 });
await page.goto(
  "data:text/html;charset=utf-8," +
    encodeURIComponent(PAGE) +
    "#overflow-test-scroll",
);
await page.addScriptTag({ content: source });
await page.evaluate(() => window.initOverflowDebug());
await page.waitForTimeout(1200); // проба вставляется через 800мс

const r = await page.evaluate(() => {
  const scan = window.__overflowScan?.();
  const panel = document.querySelector("[data-ovf-panel]");
  const cap = document.getElementById("capsule");
  const far = document.getElementById("far");
  return {
    есть: typeof window.__overflowScan === "function",
    // ВЕСЬ текст панели, а не одна строка: записка о пробе может съехать
    // на другую строку, и тогда «проба не встала» прочиталось бы как
    // «сторож не поймал» — разные диагнозы, разные действия (T11).
    записка: panel?.textContent || "",
    scrollWidth: cap.scrollWidth,
    clientWidth: cap.clientWidth,
    // ① голос: непрокручиваемая проба обязана быть в «вылезли за экран»
    голос: (scan?.boundary || []).some((b) => /ПРОБА-ЗА-ПРОКРУТК/.test(b.el)),
    // ② молчание: последний чип за краем капсулы, но прокруткой достижим
    молчание: !(scan?.boundary || []).some((b) => /Квартал/.test(b.el)),
    чипЗаКраем:
      far.getBoundingClientRect().right > cap.getBoundingClientRect().right + 1,
    группа: (scan?.boundary || []).map((b) => `${b.el} +${b.px}`),
    подробно: [...document.querySelectorAll("div,span")].map((e) => {
      const rr = e.getBoundingClientRect();
      return `${e.id || e.tagName}: ${Math.round(rr.left)}..${Math.round(
        rr.right,
      )}`;
    }),
  };
});

await browser.close();

const fail = (msg) => {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
};

if (!r.есть)
  fail("диагностика не поднялась: window.__overflowScan отсутствует");
if (/НЕ ВСТАЛА ЗА ПРОКРУТКУ/.test(r.записка))
  fail(
    "проба не встала за прокрутку — проверять было нечего, это НЕ поломка сторожа:\n  " +
      (r.записка.split("\n").find((l) => /НЕ ВСТАЛА/.test(l)) || ""),
  );
if (!r.чипЗаКраем)
  fail(
    "стенд собран неверно: чип «Квартал» не выходит за край капсулы, молчание проверять не на чем",
  );
if (!r.голос)
  fail(
    "ГОЛОС: элемент, до которого прокруткой не добраться, НЕ попал в «вылезли за экран».\n" +
      `  группа сейчас: ${
        r.группа.join(" · ") || "пусто"
      }\n  геометрия: ${r.подробно.join(" · ")}`,
  );
if (!r.молчание)
  fail(
    "МОЛЧАНИЕ: чип, достижимый прокруткой, объявлен дефектом — сторож шумит на нормальную капсулу",
  );

console.log(
  `✓ ветка «достижим прокруткой»: голос и молчание на месте ` +
    `(капсула ${r.clientWidth}/${r.scrollWidth}px, ${(
      r.записка.split("\n").find((l) => /проба/.test(l)) || ""
    ).slice(0, 70)})`,
);
