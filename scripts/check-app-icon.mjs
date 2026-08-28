// Сторож иконки экрана «Домой» (MOB-4).
//
// ⚠️ СТЕРЕЖЁТ И ПРИСУТСТВИЕ, И ОТСУТСТВИЕ. Иконка обязана быть и быть
// подключённой; манифеста и `apple-mobile-web-app-capable` быть НЕ должно.
// Второе важнее первого: манифест включает `display: standalone`, а замер
// владельца на iOS 18 показал, что в standalone QR не сканируется вовсе.
// Добавить манифест «чтобы было полноэкранно» — сломать сканер, и заметит
// это сотрудник у кассы, а не мы.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const КОРЕНЬ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ИКОНКА = path.join(КОРЕНЬ, "public/apple-touch-icon.png");
const INDEX = path.join(КОРЕНЬ, "index.html");
const ТЕМА = path.join(КОРЕНЬ, "design/theme.mjs");

const беды = [];
const сказать = (ok, текст) => {
  console.log(`  ${ok ? "✓" : "✗"} ${текст}`);
  if (!ok) беды.push(текст);
};

console.log("\nИКОНКА ЭКРАНА «ДОМОЙ» (MOB-4)");

// ⚠️ Сначала убеждаемся, что ОБЕ стороны читаются, и только потом
// сравниваем. Проверка на несуществующем файле молча даёт «совпало» —
// это T87, третий случай класса за 28.08.2026.
for (const [имя, путь] of [
  ["иконка", ИКОНКА],
  ["index.html", INDEX],
  ["канон темы", ТЕМА],
]) {
  if (!fs.existsSync(путь)) {
    console.log(`  ✗ НЕ НАЙДЕН ${имя}: ${путь}`);
    беды.push(`нет файла: ${имя}`);
  }
}
if (беды.length) {
  console.log(`\n  ⚠️ ПРОВЕРОК НЕ ВЫПОЛНЕНО: ${беды.join(" · ")}`);
  process.exit(1);
}

// размер — из заголовка IHDR, байты 16..24
const байты = fs.readFileSync(ИКОНКА);
const ширина = байты.readUInt32BE(16);
const высота = байты.readUInt32BE(20);
сказать(
  ширина === 180 && высота === 180,
  `размер ${ширина}×${высота} (ждём 180×180)`,
);

// ⚠️ КОММЕНТАРИИ ВЫРЕЗАЮТСЯ ПЕРЕД ПРОВЕРКОЙ. Первая редакция сторожа
// покраснела на собственном пояснении: в комментарии рядом со ссылкой
// написано «по той же причине НЕТ и apple-mobile-web-app-capable», и
// поиск по строке нашёл это СЛОВО, а не тег. Тот же класс, что
// вертикальные черты внутри ячеек трекера (T83/T84): объясняющий текст
// попал под проверку, предназначенную для разметки.
const html = fs.readFileSync(INDEX, "utf8").replace(/<!--[\s\S]*?-->/g, "");
сказать(
  /rel="apple-touch-icon"[^>]*apple-touch-icon\.png/.test(html),
  "подключена в index.html",
);
сказать(/apple-mobile-web-app-title/.test(html), "имя на экране задано");

// ⚠️ ОТСУТСТВИЕ — ТОЖЕ ТРЕБОВАНИЕ
сказать(
  !/rel="manifest"/.test(html),
  "манифеста НЕТ (он включил бы standalone, где сканер мёртв)",
);
сказать(
  !/apple-mobile-web-app-capable/.test(html),
  "apple-mobile-web-app-capable НЕТ (по той же причине)",
);

const канон = fs
  .readFileSync(ТЕМА, "utf8")
  .match(/cherry:\s*"(#[0-9A-Fa-f]{6})"/);
сказать(
  Boolean(канон),
  `вишнёвый читается из design/theme.mjs${канон ? ` (${канон[1]})` : ""}`,
);

if (беды.length) {
  console.log(`\n  ⚠️ РАСХОЖДЕНИЙ ${беды.length}`);
  process.exit(1);
}
console.log("  ИТОГ: иконка на месте, полноэкранный режим не включён");
