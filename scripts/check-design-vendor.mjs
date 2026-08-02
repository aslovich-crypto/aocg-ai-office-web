#!/usr/bin/env node
// Сторож вендорной копии дизайн-системы (T10, этап 1).
//
// ЗАЧЕМ. design/theme.mjs — машинная выгрузка из проекта Claude Design, а не
// наш исходник. Стоит кому-то «поправить цвет прямо здесь» — и репозиторий
// снова становится вторым местом рождения цвета, ровно тем, от чего уходим.
// Проверка сравнивает файл с записанной контрольной суммой: копия либо
// дословна, либо это не копия.
//
// ЧЕГО ЭТА ПРОВЕРКА НЕ ДЕЛАЕТ (граница, знать обязательно):
// она НЕ ходит в ДС и не знает, не изменилась ли палитра ТАМ. Коннектор
// к Claude Design требует интерактивной авторизации, в CI его нет. Свежесть
// копии — ручной шаг «подтяни ДС» (см. design/README.md), и сумма при этом
// пересчитывается вместе с файлом.
//
// Ключи темы, к которым обращается КОД, проверяет отдельный сторож
// scripts/check-theme-tokens.mjs — это другой класс ошибок.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "design", "theme.mjs");
const SUM = join(ROOT, "design", "theme.mjs.sha256");

let src, expected;
try {
  src = readFileSync(FILE);
} catch {
  console.error("\n✖ Нет design/theme.mjs — вендорная копия дизайн-системы.");
  console.error("  Подтяните export/theme.mjs из проекта Claude Design.\n");
  process.exit(1);
}
try {
  expected = readFileSync(SUM, "utf8").trim().split(/\s+/)[0];
} catch {
  console.error("\n✖ Нет design/theme.mjs.sha256 — не с чем сверять копию.\n");
  process.exit(1);
}

const actual = createHash("sha256").update(src).digest("hex");
if (actual !== expected) {
  console.error("\n✖ design/theme.mjs расходится с контрольной суммой (T10):");
  console.error(`      записано: ${expected}`);
  console.error(`      сейчас:   ${actual}`);
  console.error(
    "\n  Этот файл — дословная выгрузка из дизайн-системы, руками он не\n" +
      "  правится. Если цвет нужно изменить — менять в Claude Design и\n" +
      "  подтягивать заново (design/README.md). Если копия обновлена\n" +
      "  осознанно — пересчитайте сумму тем же шагом, что и обновление.\n",
  );
  process.exit(1);
}

const tokens = (src.toString().match(/^\s{2}\w+:/gm) || []).length;
console.log(
  `✓ вендорная копия ДС: design/theme.mjs дословна (${tokens} строк токенов)`,
);
