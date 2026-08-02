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
// Сумма живёт в source.json вместе с остальным происхождением копии,
// а не отдельным файлом: одно значение — одно место. Отдельный .sha256
// пришлось бы обновлять вторым действием, и он бы разъехался.
const META = join(ROOT, "design", "source.json");

let src, expected;
try {
  src = readFileSync(FILE);
} catch {
  console.error("\n✖ Нет design/theme.mjs — вендорная копия дизайн-системы.");
  console.error("  Подтяните export/theme.mjs из проекта Claude Design.\n");
  process.exit(1);
}
let meta;
try {
  meta = JSON.parse(readFileSync(META, "utf8"));
  expected = meta.sha256;
} catch {
  console.error(
    "\n✖ design/source.json не читается — не с чем сверять копию.\n",
  );
  process.exit(1);
}
if (typeof expected !== "string" || !/^[0-9a-f]{64}$/.test(expected)) {
  console.error(
    "\n✖ design/source.json: поле sha256 отсутствует или не похоже на хеш.\n",
  );
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

// Отметка ДС (__source) продублирована в source.json — так её видно, не
// разбирая .mjs. ЛЮБОЕ дублирование значения обязано иметь проверку, иначе
// расходится молча: сегодня мы это прошли трижды (CLAUDE.md с выдуманными
// оттенками, макет против канона, отдельный .sha256 рядом с source.json).
// Проверка ловит подмену копии на ДРУГУЮ выгрузку ДС: файловая сумма при этом
// тоже изменится, но её обновляют шагом подтяжки — а вот забыть обновить
// __source легко, и тогда происхождение врёт. Здесь это ошибка, а не тишина.
const stamp = src.toString().match(/export const __source = \{([^}]*)\}/);
const canonSha =
  stamp && (stamp[1].match(/sha256:\s*"([0-9a-f]{64})"/) || [])[1];
if (!canonSha) {
  console.error("\n✖ design/theme.mjs: нет отметки __source с sha256 канона.");
  console.error(
    "  Подтяните выгрузку заново — старые сборки её не содержат.\n",
  );
  process.exit(1);
}
if (!meta.__source || meta.__source.sha256 !== canonSha) {
  console.error(
    "\n✖ design/source.json.__source не совпадает с отметкой в копии:",
  );
  console.error(
    `      в source.json: ${meta.__source && meta.__source.sha256}`,
  );
  console.error(`      в theme.mjs:   ${canonSha}`);
  console.error(
    "\n  Копию подтянули, а происхождение не обновили. Берите __source\n" +
      "  ИЗ выгрузки, руками не вводите.\n",
  );
  process.exit(1);
}

// Дату печатаем СПРАВОЧНО, без порога и без предупреждения: время не связано
// с тем, изменилась ли палитра (см. T12). Строка нужна, чтобы при разборе
// было видно, от какого числа копия, а не чтобы кого-то торопить.
console.log(
  `✓ вендорная копия ДС: design/theme.mjs дословна ` +
    `(${meta.tokens} токенов, подтянута ${meta.pulledAt}, ` +
    `канон ${canonSha.slice(0, 8)}… от ${meta.__source.built})`,
);
