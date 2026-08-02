// Общий разбор исходников для сторожей (check-theme-tokens, check-layout-shrink).
// Вынесено из check-theme-tokens: копия этого сканера во втором стороже
// разошлась бы с оригиналом при первой же правке — ровно та болезнь,
// с которой мы боремся в теме и в документации.

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// ── 1. Комментарии вон, строки на месте ──────────────────────────────────────
// Комментарии заменяются пробелами (длина файла и номера строк сохраняются),
// а вот содержимое шаблонных строк остаётся: `1px solid ${T.border}` — это
// НАСТОЯЩЕЕ чтение токена, вырезав его, сторож пропустил бы половину кода.
// Внутри `${…}` возвращаемся в обычный режим — отсюда стек состояний.
export function stripComments(src) {
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

// Второй проход: то же самое, плюс СОДЕРЖИМОЕ строк в кавычках.
// Нужен только для поиска ОБРАЩЕНИЙ. Иначе путь импорта
// `from "../../design/theme.mjs"` читается как обращение theme.mjs —
// поймал себя на этом сразу после расширения регулярки на строчные имена.
// Для разбора КЛЮЧЕЙ этот проход не годится: ключи бывают в кавычках
// («На проверке»: …), и погасив строки, мы потеряли бы их.
export function blankStrings(src) {
  const out = Array.from(src);
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'") {
      const end = skipQuoted(src, i, c);
      for (let j = i + 1; j < end - 1; j++) if (out[j] !== "\n") out[j] = " ";
      i = end;
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

// ── 4. Обход исходников ──────────────────────────────────────────────────────
export function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(js|jsx|mjs)$/.test(name)) acc.push(p);
  }
  return acc;
}
