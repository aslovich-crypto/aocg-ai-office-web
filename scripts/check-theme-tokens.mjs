#!/usr/bin/env node
// Сторож несуществующих токенов темы (задача T9).
//
// ЗАЧЕМ. Обращение к отсутствующему ключу карты токенов возвращает undefined,
// React молча выбрасывает такое свойство из inline-стиля — и стиль просто не
// применяется. Ни ESLint, ни сборка об этом не знают: для них C и T — обычные
// объекты. За одну сессию класс выстрелил трижды:
//   C.bg          → фон экрана деталей отчёта стал прозрачным;
//   T.warningFg   → цвет предупреждения не применился;
//   T.surfaceSunk → фон блока не применился.
//
// ПОЧЕМУ НЕ PROXY. Proxy на C ловит только общую тему (треть класса — две из
// трёх ошибок были в ЛОКАЛЬНОЙ карте T) и срабатывает лишь в момент рендера
// в dev-режиме, которого нет в нашем цикле проверки (lint + build + живой
// прод). В проде тот же Proxy превратил бы опечатку в белый экран у клиента.
// Статическая проверка ловит все вхождения и до коммита.
//
// ═══ СЛЕПОЕ ПЯТНО (граница проверки, знать обязательно) ═══
// Проверяются ТОЛЬКО чтения через точку: C.light, T.border.
// ВЫЧИСЛЯЕМЫЙ ДОСТУП НЕ ПРОВЕРЯЕТСЯ: C[key], T[cond ? "a" : "b"], C[`x${n}`].
// Ключ там известен лишь во время работы программы, статически его не узнать.
// Сейчас так в коде не пишут; если появится — проверка о нём промолчит,
// и это НЕ значит, что доступ корректен.
// Также не проверяются карты, чьё содержимое нельзя узнать из литерала:
// пустые ({}), со spread'ом (...base) или с вычисляемыми ключами ([k]: v) —
// такие пропускаются целиком, о чём сообщается в сводке прогона.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const THEME_FILE = join(SRC, "lib", "theme.js");

// Карта считается картой токенов, если объявлена как `const ИМЯ = {…}` и имя
// набрано заглавными (C, T, TOK, TAG_1199). Узкое имя из одной-двух букв —
// именно тот случай, где опечатка не бросается в глаза.
const MAP_NAME = /^[A-Z][A-Z0-9_]*$/;

// ── 1. Комментарии вон, строки на месте ──────────────────────────────────────
// Комментарии заменяются пробелами (длина файла и номера строк сохраняются),
// а вот содержимое шаблонных строк остаётся: `1px solid ${T.border}` — это
// НАСТОЯЩЕЕ чтение токена, вырезав его, сторож пропустил бы половину кода.
// Внутри `${…}` возвращаемся в обычный режим — отсюда стек состояний.
function stripComments(src) {
  const out = Array.from(src);
  const blank = (from, to) => {
    for (let i = from; i < to; i++) if (out[i] !== "\n") out[i] = " ";
  };
  // Стек: "code" | "tpl". Строки в кавычках и комментарии проходим на месте.
  const stack = ["code"];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    const top = stack[stack.length - 1];

    if (top === "code" || top === "tpl-expr") {
      if (c === "/" && n === "/") {
        const end = src.indexOf("\n", i);
        blank(i, end === -1 ? src.length : end);
        i = end === -1 ? src.length : end;
        continue;
      }
      if (c === "/" && n === "*") {
        // `/*` не может начинать регулярное выражение (пустой квантификатор),
        // поэтому проверка на регэксп здесь не нужна.
        const end = src.indexOf("*/", i + 2);
        const to = end === -1 ? src.length : end + 2;
        blank(i, to);
        i = to;
        continue;
      }
      if (c === '"' || c === "'") {
        i = skipQuoted(src, i, c);
        continue;
      }
      if (c === "`") {
        stack.push("tpl");
        i++;
        continue;
      }
      if (c === "}" && top === "tpl-expr") {
        stack.pop();
        i++;
        continue;
      }
      i++;
      continue;
    }

    if (top === "tpl") {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "$" && n === "{") {
        stack.push("tpl-expr");
        i += 2;
        continue;
      }
      if (c === "`") {
        stack.pop();
        i++;
        continue;
      }
      i++;
      continue;
    }
    i++;
  }
  return out.join("");
}

function skipQuoted(src, start, quote) {
  let i = start + 1;
  while (i < src.length) {
    if (src[i] === "\\") {
      i += 2;
      continue;
    }
    if (src[i] === quote || src[i] === "\n") return i + 1;
    i++;
  }
  return i;
}

// ── 2. Ключи объектного литерала ─────────────────────────────────────────────
// Возвращает {keys} либо {skip: "причина"}, если состав литерала статически
// неизвестен (spread, вычисляемые ключи, пустой объект).
function objectKeys(src, braceStart) {
  const keys = new Set();
  let depth = 0;
  let i = braceStart;
  let bodyStart = -1;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "{" || c === "[" || c === "(") {
      depth++;
      if (depth === 1) bodyStart = i + 1;
    } else if (c === "}" || c === "]" || c === ")") {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) return { skip: "литерал не закрыт" };
  const body = src.slice(bodyStart, i);
  if (body.includes("...")) return { skip: "spread — состав неизвестен" };

  // Ключи верхнего уровня: пропускаем всё, что вложено в скобки.
  let d = 0;
  let atValue = false;
  let token = "";
  for (let j = 0; j < body.length; j++) {
    const c = body[j];
    if (c === "{" || c === "[" || c === "(") {
      if (d === 0 && !atValue && c === "[")
        return { skip: "вычисляемый ключ [x]: — состав неизвестен" };
      d++;
      continue;
    }
    if (c === "}" || c === "]" || c === ")") {
      d--;
      continue;
    }
    if (d !== 0) continue;
    if (c === ":" && !atValue) {
      const k = token.trim().replace(/^["']|["']$/g, "");
      if (k) keys.add(k);
      atValue = true;
      token = "";
      continue;
    }
    if (c === ",") {
      atValue = false;
      token = "";
      continue;
    }
    if (!atValue) token += c;
  }
  if (keys.size === 0) return { skip: "пустой литерал" };
  return { keys };
}

function findMaps(src) {
  const maps = new Map();
  const re = /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1];
    if (!MAP_NAME.test(name)) continue;
    maps.set(name, objectKeys(src, m.index + m[0].lastIndexOf("{")));
  }
  return maps;
}

// ── 3. Похожие ключи для подсказки ───────────────────────────────────────────
function distance(a, b) {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return dp[b.length];
}

// Порог зависит от длины ключа. Раньше он был фиксированным (4) — и на
// коротком `bg` подсказка предлагала mid/dark/gray, которые к делу не
// относятся, а полный список (где и лежал нужный light) не показывался.
// Три случайных слова хуже, чем честное «есть только: …», поэтому лучше
// промолчать, чем угадывать: для 2-3 букв допускаем расхождение в один
// символ, для длинных — до трёх.
function suggest(key, keys) {
  const lk = key.toLowerCase();
  const limit = lk.length <= 3 ? 1 : lk.length <= 6 ? 2 : 3;
  return [...keys]
    .map((k) => {
      const lower = k.toLowerCase();
      // Общее начало — сильный сигнал: lightGray против light различаются
      // на 4 символа, но это очевидно «то самое».
      const near = lower.startsWith(lk) || lk.startsWith(lower);
      return { k, d: near ? 0 : distance(lk, lower) };
    })
    .filter((x) => x.d <= limit)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map((x) => x.k);
}

// ── 4. Обход исходников ──────────────────────────────────────────────────────
function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(js|jsx|mjs)$/.test(name)) acc.push(p);
  }
  return acc;
}

const themeSrc = stripComments(readFileSync(THEME_FILE, "utf8"));
const themeMaps = findMaps(themeSrc);

// --verbose печатает, ЧТО именно проверено. Прогон без находок сам по себе
// ничего не доказывает: он одинаково выглядит и когда всё чисто, и когда
// сторож ничего не нашёл (не разобрал карту, не дошёл до файла). Разбивка
// делает результат проверяемым.
const VERBOSE = process.argv.includes("--verbose");

const problems = [];
const skipped = [];
const coverage = [];
let readsChecked = 0;
let mapsChecked = 0;

for (const file of walk(SRC)) {
  const raw = readFileSync(file, "utf8");
  const src = stripComments(raw);
  const rel = relative(ROOT, file);

  const local = findMaps(src);
  const known = new Map();

  for (const [name, def] of local) {
    if (def.skip) skipped.push(`${rel}: ${name} — ${def.skip}`);
    else known.set(name, def.keys);
  }

  // Палитра приходит в файл ТРЕМЯ путями: импортом из lib/theme, пропсом из
  // App.jsx (GlavnayaPage, OrganizationTab) или локальным объявлением. Ловить
  // только импорт — значит не покрыть половину экранов: первая версия сторожа
  // так и пропустила GlavnayaPage целиком. Поэтому имя C всюду считается
  // палитрой: в этом репозитории другого C нет. Локальное объявление, если
  // появится, перекроет это (оно уже разобрано выше).
  if (!known.has("C") && themeMaps.get("C")?.keys) {
    known.set("C", themeMaps.get("C").keys);
  }

  // Импортированные из lib/theme карты — ключи берём оттуда.
  const imports = [
    ...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*lib\/theme["']/g),
  ];
  for (const im of imports) {
    for (const part of im[1].split(",")) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        .trim();
      if (!name || known.has(name)) continue;
      const def = themeMaps.get(name);
      if (def && def.keys) known.set(name, def.keys);
      else if (def && def.skip)
        skipped.push(`lib/theme.js: ${name} — ${def.skip}`);
    }
  }
  mapsChecked += known.size;
  if (known.size === 0) continue;

  // Присваивание в карту (T.x = …) — тоже объявление ключа, а не ошибка.
  for (const [, name, key] of src.matchAll(
    /\b([A-Z][A-Z0-9_]*)\.([A-Za-z_$][\w$]*)\s*=[^=]/g,
  )) {
    if (known.has(name)) known.get(name).add(key);
  }

  const perFile = new Map();
  for (const m of src.matchAll(/\b([A-Z][A-Z0-9_]*)\.([A-Za-z_$][\w$]*)/g)) {
    const [, name, key] = m;
    const keys = known.get(name);
    if (!keys) continue; // карта не наша (Math.max, JSON.parse, React.Fragment)
    readsChecked++;
    perFile.set(name, (perFile.get(name) || 0) + 1);
    if (keys.has(key)) continue;
    const line = src.slice(0, m.index).split("\n").length;
    problems.push({
      file: rel,
      line,
      name,
      key,
      hint: suggest(key, keys),
      known: [...keys],
    });
  }

  coverage.push({
    rel,
    maps: [...known].map(([n, k]) => `${n}(${k.size} ключей)`),
    reads: [...perFile].map(([n, c]) => `${n}×${c}`),
  });
}

// ── 5. Отчёт ────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error("\n✖ Обращение к несуществующему токену темы (T9):\n");
  for (const p of problems) {
    console.error(
      `  ${p.file}:${p.line}  ${p.name}.${p.key} — такого ключа нет`,
    );
    if (p.hint.length) {
      console.error(
        `      может быть, ${p.hint
          .map((h) => `${p.name}.${h}`)
          .join(" или ")}?`,
      );
    } else {
      console.error(`      есть только: ${p.known.join(", ")}`);
    }
  }
  console.error(
    "\n  Такое обращение даёт undefined — стиль молча не применится.\n" +
      "  Добавьте ключ в карту токенов или используйте существующий.\n",
  );
  process.exit(1);
}

if (VERBOSE) {
  console.log("Охват проверки:");
  for (const c of coverage) {
    console.log(`  ${c.rel}`);
    console.log(`      карты:  ${c.maps.join(", ")}`);
    console.log(`      чтения: ${c.reads.length ? c.reads.join(", ") : "нет"}`);
  }
  console.log("");
}

console.log(
  `✓ токены темы: проверено ${readsChecked} обращений в ${mapsChecked} картах, ` +
    `несуществующих нет`,
);
if (skipped.length) {
  console.log(
    `  пропущены карты с неизвестным составом: ${skipped.join("; ")}`,
  );
}
