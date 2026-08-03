#!/usr/bin/env node
// Сторож вёрстки, которая ломается на узком экране (задача T14).
//
// ЗАЧЕМ. Ни eslint, ни сборка, ни остальные сторожа не видят этот класс:
// размеры существуют только ПОСЛЕ раскладки, а её делает браузер. За один
// день 02.08.2026 три бага пришли из трёх шаблонов, и все три статические:
//   • капсула периода и нижнее меню уезжали за экран — flex:1 без minWidth:0;
//   • плитки «Главной» обрезались справа — 1fr в grid без minmax(0,1fr);
//   • 31 место шире родителя всегда — width:100% + padding при content-box.
// Правила читают исходники и браузер не требуют. Они НЕ доказывают, что
// вёрстка цела (это T15, браузерная проверка ширин), но вычёркивают три
// причины, которые уже выстрелили.
//
// ═══ ПОЧЕМУ ХРАПОВИК, А НЕ ПРОСТО СПИСОК ОШИБОК ═══
// В коде уже есть нарушения, и часть из них снимается только вместе с T13
// (глобальный box-sizing), который отложен осознанно. Сделать правило
// предупреждением — значит превратить его в фон, который перестают читать
// через неделю. Поэтому нарушения посчитаны по файлам и записаны в baseline:
// число может только УМЕНЬШАТЬСЯ. Новое нарушение — ошибка. Починили —
// сторож попросит опустить планку, иначе baseline тихо зарастёт.
//
// ═══ ГРАНИЦЫ (знать обязательно) ═══
// • Считаются inline-стили в объектных литералах. CSS-классы и внешние
//   таблицы стилей не разбираются вовсе.
// • Правило minWidth не отличает флекс-СТРОКУ от флекс-ЯЧЕЙКИ: для обеих
//   отсутствие minWidth:0 — потенциальная жёсткость, но опасна она в разной
//   степени. Отсюда и baseline, а не запрет с первого дня.
// • Ключ baseline — файл, а не строка: номера строк съезжают от любой правки
//   выше, и список превратился бы в шум.

import { readFileSync, writeFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments, walk } from "./lib/source-scan.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const BASE_FILE = join(ROOT, "scripts", "layout-shrink-baseline.json");
const UPDATE = process.argv.includes("--update");

const RULES = {
  "flex-no-minwidth":
    "flex:1 без minWidth:0 — элемент не сожмётся уже своего содержимого",
  "grid-1fr-no-minmax":
    "1fr без minmax(0,1fr) — дорожка не сожмётся уже содержимого",
  "full-width-padding":
    "width:100% + padding при content-box — элемент шире родителя всегда",
};

// Границы объектного литерала, внутри которого стоит совпадение: от него
// назад до открывающей `{` своего уровня и вперёд до парной `}`.
function objectAround(src, at) {
  let depth = 0,
    start = -1;
  for (let i = at; i >= 0; i--) {
    const c = src[i];
    if (c === "}") depth++;
    else if (c === "{") {
      if (depth === 0) {
        start = i;
        break;
      }
      depth--;
    }
  }
  if (start < 0) return "";
  depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return src.slice(start);
}

const lineOf = (src, i) => src.slice(0, i).split("\n").length;

function checkFile(src) {
  const hits = [];
  const add = (rule, i) => hits.push({ rule, line: lineOf(src, i) });

  // ── 1. flex: 1 без ЯВНОГО minWidth в том же объекте стиля
  //
  // Ловим забывчивость, а не осознанный пол. Опасность правила — min-width:auto
  // по умолчанию: элемент не сжимается уже СОДЕРЖИМОГО, и соседи уезжают.
  // Любое явное число этот механизм отключает: minWidth:0 разрешает сжатие
  // до нуля, minWidth:148 — до 148, и оба заведомо меньше содержимого.
  // Случай, из-за которого правило расширено (03.08.2026, «Главная»): левой
  // колонке карточки нужен именно ПОЛ 148px — иначе длинная категория
  // съедала её до 46.9px и оттуда торчали дата и способ оплаты. minWidth:0
  // там был бы неправдой: колонке ЕСТЬ куда сжиматься, но не до нуля.
  // "auto" не принимается намеренно — это и есть значение по умолчанию,
  // записанное словом, то есть ровно тот случай, который правило ловит.
  for (const m of src.matchAll(/\bflex:\s*1\s*,/g)) {
    const obj = objectAround(src, m.index);
    if (!/minWidth:\s*(0\b|[1-9]\d*\b|"\d+(px|%)")/.test(obj))
      add("flex-no-minwidth", m.index);
  }

  // ── 2. 1fr в gridTemplateColumns без minmax
  for (const m of src.matchAll(/gridTemplateColumns:\s*("[^"]*"|`[^`]*`)/g)) {
    if (/\b1fr\b/.test(m[1]) && !/minmax\(/.test(m[1]))
      add("grid-1fr-no-minmax", m.index);
  }

  // ── 3. width:"100%" вместе с padding/border при content-box.
  // boxSizing:"border-box" в том же объекте снимает вопрос — это и есть
  // точечная альтернатива глобальному сбросу из T13.
  for (const m of src.matchAll(/width:\s*"100%"\s*,/g)) {
    const obj = objectAround(src, m.index);
    if (/boxSizing:\s*"border-box"/.test(obj)) continue;
    const hasPad = /\bpadding(?:Left|Right|Inline)?:\s*(?!0[,\s])/.test(obj);
    const hasBorder = /\bborder(?:Left|Right)?:\s*[`"']?\s*\d/.test(obj);
    if (hasPad || hasBorder) add("full-width-padding", m.index);
  }
  return hits;
}

// ── прогон ───────────────────────────────────────────────────────────────
const counts = {};
const detail = {};
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file);
  const hits = checkFile(stripComments(readFileSync(file, "utf8")));
  if (!hits.length) continue;
  counts[rel] = {};
  detail[rel] = hits;
  for (const h of hits) counts[rel][h.rule] = (counts[rel][h.rule] || 0) + 1;
}

if (UPDATE) {
  writeFileSync(
    BASE_FILE,
    JSON.stringify(
      {
        _: "Известные нарушения на момент введения правил (T14). Число может только УМЕНЬШАТЬСЯ: сторож требует опускать планку после каждой починки, иначе список тихо зарастает. Записи full-width-padding снимаются вместе с T13 (глобальный box-sizing) — до тех пор они не ошибка, а зафиксированный долг.",
        counts,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("baseline обновлён:", relative(ROOT, BASE_FILE));
  process.exit(0);
}

let base;
try {
  base = JSON.parse(readFileSync(BASE_FILE, "utf8")).counts;
} catch {
  console.error(
    "\n✖ Нет scripts/layout-shrink-baseline.json — не с чем сравнивать.\n" +
      "  Создать: node scripts/check-layout-shrink.mjs --update\n",
  );
  process.exit(1);
}

const grew = [];
const shrank = [];
const names = new Set([...Object.keys(base), ...Object.keys(counts)]);
for (const f of names) {
  for (const rule of Object.keys(RULES)) {
    const was = (base[f] || {})[rule] || 0;
    const now = (counts[f] || {})[rule] || 0;
    if (now > was) grew.push({ f, rule, was, now });
    else if (now < was) shrank.push({ f, rule, was, now });
  }
}

if (grew.length) {
  console.error(
    "\n✖ Новая жёсткая вёрстка — сломается на узком экране (T14):\n",
  );
  for (const g of grew) {
    console.error(`  ${g.f}: ${g.rule} было ${g.was}, стало ${g.now}`);
    console.error(`      ${RULES[g.rule]}`);
    const lines = (detail[g.f] || [])
      .filter((h) => h.rule === g.rule)
      .map((h) => h.line);
    console.error(`      строки: ${lines.join(", ")}`);
  }
  console.error(
    "\n  Починка: flex:1 → добавить minWidth:0; 1fr → minmax(0,1fr);\n" +
      '  width:100% с padding → boxSizing:"border-box" в том же стиле.\n' +
      "  Разрешив сжатие, ограничьте и содержимое, иначе оно вылезет.\n",
  );
  process.exit(1);
}

if (shrank.length) {
  console.error("\n✖ Нарушений стало меньше — опустите планку (T14):\n");
  for (const s of shrank)
    console.error(`  ${s.f}: ${s.rule} было ${s.was}, стало ${s.now}`);
  console.error(
    "\n  Выполните: node scripts/check-layout-shrink.mjs --update\n" +
      "  Без этого baseline зарастёт обратно и перестанет что-либо значить.\n",
  );
  process.exit(1);
}

const total = Object.values(counts).reduce(
  (s, r) => s + Object.values(r).reduce((a, b) => a + b, 0),
  0,
);
console.log(
  `✓ жёсткая вёрстка: новых нарушений нет (зафиксировано ${total}, снимаются по T13/T14)`,
);
