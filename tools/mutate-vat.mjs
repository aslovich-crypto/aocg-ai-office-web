#!/usr/bin/env node
/**
 * МУТАЦИИ СТОРОЖА ВХОДЯЩЕГО НДС (`scripts/check-vat-sum.mjs`).
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ. Сторож ходит в `npm run lint` и отвечает на вопрос
 * «сходится ли расчёт с ожидаемым». Он НЕ отвечает на вопрос «а заметил бы
 * он, если бы расчёт сломали». Правило репозитория прямое: сторож, не
 * проверенный мутацией, считается неработающим (T11).
 *
 * ЧЕМ ЭТО ОПЛАЧЕНО. 10.08.2026 `src/lib/tax.js` полтора месяца считал НДС
 * как `vat_20 + vat_10` — список из двух ставок в коде фронта. С появлением
 * ставки 22% блок «Входящий НДС» показывал 1 385,62 ₽ вместо 4 702,11 ₽,
 * занижение 70,5%. Цифру переносят в декларацию (NDS-VAT22).
 *
 * ЧТО ЛОМАЕТСЯ (по очереди, каждая мутация — отдельная способность):
 *   M1  вернуть хвост vat_20+vat_10 — колонок в БД больше нет (NDS-CLEANUP ③);
 *   M2  перестать читать vat_total — фото-чеки дадут 0;
 *   M3  вернуть список ставок в разбивку — 22% снова выпадет;
 *   M4  сложить разбивку и vat_total — двойной счёт.
 *
 * Мутация засчитывается, только если РЕАЛЬНО применилась: цель ищется
 * в тексте, изменение сверяется, файл возвращается в `finally`.
 *
 * ЗАПУСК (в `npm run lint` НЕ входит — правит файл и возвращает на место):
 *     node tools/mutate-vat.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const КОРЕНЬ = join(dirname(fileURLToPath(import.meta.url)), "..");
const TAX = join(КОРЕНЬ, "src", "lib", "tax.js");
const СТОРОЖ = join(КОРЕНЬ, "scripts", "check-vat-sum.mjs");

const МУТАЦИИ = [
  [
    "M1 хвост vat_20+vat_10 возвращён (колонок в БД уже нет)",
    "  return Number(r?.vat_total) || 0;",
    "  const t = Number(r?.vat_total) || 0;\n  if (t > 0) return t;\n" +
      "  return (Number(r?.vat_20) || 0) + (Number(r?.vat_10) || 0);",
  ],
  [
    "M2 vat_total больше не читается (фото-чеки дают 0)",
    "  return Number(r?.vat_total) || 0;",
    "  return 0;",
  ],
  [
    "M3 список ставок вернулся в разбивку (22% выпал)",
    "    const сумма = Object.values(bd).reduce((a, v) => a + (Number(v) || 0), 0);",
    "    const сумма = (Number(bd[20]) || 0) + (Number(bd[10]) || 0);",
  ],
  [
    "M4 двойной счёт: разбивка И vat_total складываются",
    "    if (сумма > 0) return сумма;",
    "    if (сумма > 0) return сумма + (Number(r?.vat_total) || 0);",
  ],
];

const прогон = () => {
  try {
    execFileSync("node", [СТОРОЖ], { encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
};

const оригинал = readFileSync(TAX, "utf8");
console.log(
  `База: сторож ${прогон() ? "зелёный" : "КРАСНЫЙ — чинить до мутаций"}`,
);
let провалы = прогон() ? 0 : 1;

try {
  for (const [имя, старое, новое] of МУТАЦИИ) {
    if (!оригинал.includes(старое)) {
      console.log(
        `  ✗ ${имя}: ЦЕЛЬ НЕ НАЙДЕНА — ломать нечего, мутация не засчитана`,
      );
      провалы++;
      continue;
    }
    const текст = оригинал.replace(старое, новое);
    if (текст === оригинал) {
      console.log(`  ✗ ${имя}: ТЕКСТ НЕ ИЗМЕНИЛСЯ`);
      провалы++;
      continue;
    }
    writeFileSync(TAX, текст);
    const поймал = !прогон();
    if (!поймал) провалы++;
    console.log(`  ${поймал ? "✓ поймана" : "✗ ПРОПУЩЕНА"} — ${имя}`);
    writeFileSync(TAX, оригинал);
  }
} finally {
  writeFileSync(TAX, оригинал);
}

console.log(
  `\nПосле восстановления сторож ${прогон() ? "зелёный" : "КРАСНЫЙ"}`,
);
console.log(`Проверено способностей: ${МУТАЦИИ.length}, провалов: ${провалы}`);
process.exit(провалы ? 1 : 0);
