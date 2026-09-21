import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ⚠️ ПУТЬ СЧИТАЕТСЯ ОТ САМОГО ФАЙЛА, А НЕ ВПИСАН. Абсолютный путь с чужим
// именем пользователя — это прибор, прибитый к машине автора (класс T81):
// у любого другого он молча не найдёт исходник и объявит проверку пройденной.
const КОРЕНЬ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(КОРЕНЬ, "src/components/ReceiptDetailModal.jsx");
if (!fs.existsSync(SRC)) {
  console.error(`✗ ИСХОДНИК НЕ НАЙДЕН: ${SRC}`);
  process.exit(1);
}
const т = fs.readFileSync(SRC, "utf8");

// ⚠️ Выражения ВЫРЕЗАЮТСЯ ИЗ ИСХОДНИКА, а не переписываются: иначе проверялась
// бы копия, а расхождение копии с оригиналом — ровно тот класс, что T39.
function вырезать(от, до) {
  const a = т.indexOf(от);
  const b = т.indexOf(до, a);
  if (a < 0 || b < 0) throw new Error(`не нашёл фрагмент: ${от.slice(0, 40)}`);
  return т.slice(a, b);
}

const БЛОК_СТАВОК = вырезать(
  "  const ПОРЯДОК_СТАВОК = [",
  "  // ── разбивка оплаты",
);
const БЛОК_СОСТОЯНИЙ = вырезать(
  "  const ставкиПозиций =",
  "\n\n  // ── позиции:",
);
// TAG_1199 и vatRateLabel — целиком из файла
const БЛОК_КАРТЫ = вырезать("const TAG_1199 = {", "\n\n");
const БЛОК_ПОДПИСИ = вырезать("function vatRateLabel(nds) {", "\n}\n") + "\n}";

const тело = `
${БЛОК_КАРТЫ}
${БЛОК_ПОДПИСИ}
return function (r, raw) {
${БЛОК_СТАВОК}
  const обороты = [
    ["Оборот по ставке 0%", r.sum_vat_0],
    ["Оборот без НДС", r.sum_no_vat],
  ].filter(([, v]) => v !== null && v !== undefined);
${БЛОК_СОСТОЯНИЙ}
  return { vatRows, обороты, состояниеНДС };
};`;

const посчитать = new Function(тело)();

const СЛУЧАИ = [
  [
    "АЗБУКА 3735 — две ставки, работало и обязано работать",
    { vat_breakdown: { 20: 300.5, 10: 42.1 } },
    { items: [{ nds: 1 }, { nds: 2 }] },
  ],
  [
    "МАКСИДОМ id=70 ПОСЛЕ пересчёта — свод от ФНС доехал",
    { vat_breakdown: { 22: 1277.62 } },
    { items: [{ nds: 11 }, { nds: 11 }] },
  ],
  [
    "МАКСИДОМ id=70 ДО пересчёта — свода нет, ставка в позициях есть",
    { vat_breakdown: null, sum_vat_0: null, sum_no_vat: null },
    { items: [{ nds: 11 }] },
  ],
  [
    "id=61 — весь чек по ставке 0%, обороты названы точнее ярлыка",
    { vat_breakdown: null, sum_vat_0: 2670.0, sum_no_vat: 0.0 },
    { items: [{ nds: 5 }, { nds: 6 }] },
  ],
  [
    "САД 3500 photo_ocr — модель ставку не прочла",
    { vat_breakdown: null, sum_vat_0: null, sum_no_vat: null },
    { items: [{ name: "Ужин" }] },
  ],
  [
    "РАСЧЁТНАЯ СТАВКА — то, ради чего снят белый список",
    { vat_breakdown: { "20/120": 100.0, 20: 200.0 } },
    { items: [{ nds: 3 }, { nds: 1 }] },
  ],
  [
    "НЕПРЕДВИДЕННЫЙ КЛЮЧ — обязан быть ВИДЕН, а не отброшен",
    { vat_breakdown: { 13.5: 77.0 } },
    { items: [] },
  ],
];

console.log("СЛУЧАЙ".padEnd(58), "СТРОКИ НДС".padEnd(34), "СОСТОЯНИЕ");
console.log("─".repeat(112));
for (const [имя, r, raw] of СЛУЧАИ) {
  const { vatRows, состояниеНДС } = посчитать(r, raw);
  const строки = vatRows.map(([k, v]) => `${k}=${v}`).join(" · ") || "—";
  console.log(имя.padEnd(58), строки.padEnd(34), состояниеНДС ?? "—");
}

// ── СТРУКТУРНЫЕ ПРОВЕРКИ: то, что живёт внутри JSX и не вырезается выражением
const СТРУКТУРА = [
  ["бейдж ставки не гасится ни на чём", () => /const showVat = true;/.test(т)],
  [
    'позиция без кода подписана "Нет данных"',
    () => /vatRateLabel\(it\.nds\) \|\| "Нет данных"/.test(т),
  ],
  ["белого списка ставок не осталось", () => !/const VAT_ORDER =/.test(т)],
  ["строка состояния попадает в рендер", () => /\{состояниеНДС && \(/.test(т)],
];
let плохо = 0;
console.log("\nСТРУКТУРА");
for (const [имя, проверка] of СТРУКТУРА) {
  const ок = проверка();
  if (!ок) плохо++;
  console.log(`  ${ок ? "✓" : "✗"} ${имя}`);
}

// ── ОЖИДАЕМЫЕ СОСТОЯНИЯ: прибор обязан ПАДАТЬ, а не просто печатать
const ЖДЁМ = ["—", "—", "Сумма не указана", "—", "Нет данных о НДС", "—", "—"];
console.log("\nСВЕРКА С ОЖИДАЕМЫМ");
СЛУЧАИ.forEach(([имя, r, raw], i) => {
  const { состояниеНДС, vatRows } = посчитать(r, raw);
  const было = состояниеНДС ?? "—";
  if (было !== ЖДЁМ[i]) {
    плохо++;
    console.log(
      `  ✗ ${имя}: ждали ${
        ЖДЁМ[i] !== undefined ? ЖДЁМ[i] : "?"
      }, вышло ${было}`,
    );
  }
  if (i === 6 && vatRows.length !== 1) {
    плохо++;
    console.log(
      `  ✗ непредвиденный ключ ОТБРОШЕН — строк ${vatRows.length}, ждали 1`,
    );
  }
  if (i === 5 && vatRows.length !== 2) {
    плохо++;
    console.log(
      `  ✗ расчётная ставка потеряна — строк ${vatRows.length}, ждали 2`,
    );
  }
});
console.log(плохо === 0 ? "  ✓ все сошлись" : `  ⚠️ РАСХОЖДЕНИЙ ${плохо}`);
process.exit(плохо === 0 ? 0 : 1);
