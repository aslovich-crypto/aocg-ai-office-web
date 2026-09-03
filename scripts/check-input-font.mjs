// Сторож T138: у полей ввода кегль не меньше 16px — иначе Safari на iOS
// масштабирует страницу при фокусе и запоминает масштаб для домена.
//
// ⚠️ ХРАПОВИК, КАК У ВЁРСТКИ (T14): пока поля поднимаются по одному объекту
// стиля за коммит (процедура владельца), число нарушителей может только
// УБЫВАТЬ. Выросло — красный. Опустилось — сторож требует опустить планку
// тем же коммитом (--update), чтобы возврат назад был виден.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const КОРЕНЬ = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const ПЛАНКА = path.join(КОРЕНЬ, "scripts", "input-font-baseline.json");
const ПОРОГ = 16;

// обход руками — пакета glob в проекте нет, и тянуть его ради этого не за чем
import { readdirSync, statSync } from "node:fs";
function обойти(дир) {
  const итог = [];
  for (const и of readdirSync(дир)) {
    const п = path.join(дир, и);
    if (statSync(п).isDirectory()) итог.push(...обойти(п));
    else if (п.endsWith(".jsx")) итог.push(п);
  }
  return итог;
}
const файлы = обойти(path.join(КОРЕНЬ, "src")).map((п) => path.relative(КОРЕНЬ, п));
const нарушители = [];
for (const ф of файлы) {
  const т = readFileSync(path.join(КОРЕНЬ, ф), "utf-8");
  // ① инлайновые стили прямо на поле
  for (const м of т.matchAll(/<(input|textarea|select)\b[^<]{0,900}?style=\{\{([^<]*?)\}\}/g)) {
    const блок = м[2];
    const fs = /fontSize:\s*(\d+)/.exec(блок);
    const fshort = /font:[^;\n]*?(\d+(?:\.\d+)?)px/.exec(блок);
    const размер = fs ? +fs[1] : fshort ? +fshort[1] : null;
    if (размер !== null && размер < ПОРОГ)
      нарушители.push(`${ф}: <${м[1]}> инлайн ${размер}px`);
  }
  // ② поле со style={Имя} — ищем объект Имя в том же файле
  for (const м of т.matchAll(/<(input|textarea|select)\b[^<]{0,600}?style=\{(?:\{\s*)?\.\.\.?([A-Za-zА-Яа-яЁё_$][\w$А-Яа-яЁё]*)|<(input|textarea|select)\b[^<]{0,600}?style=\{([A-Za-zА-Яа-яЁё_$][\w$А-Яа-яЁё]*)\}/g)) {
    const имя = м[2] || м[4];
    const тег = м[1] || м[3];
    if (!имя) continue;
    const об = new RegExp(`(?:const|let)\\s+${имя}\\s*=\\s*\\{([\\s\\S]{0,700}?)\\n\\s*\\}`).exec(т);
    if (!об) continue;
    const fs = /fontSize:\s*(\d+)/.exec(об[1]);
    const fshort = /font:[^;\n]*?(\d+(?:\.\d+)?)px/.exec(об[1]);
    const размер = fs ? +fs[1] : fshort ? +fshort[1] : null;
    if (размер !== null && размер < ПОРОГ)
      нарушители.push(`${ф}: <${тег}> style={${имя}} ${размер}px`);
  }
}
const уник = [...new Set(нарушители)].sort();

console.log("\nКЕГЛЬ ПОЛЕЙ ВВОДА (T138: меньше 16px — Safari зумит и помнит)");
console.log(`  НАЙДЕНО нарушителей: ${уник.length}`);
for (const н of уник) console.log(`   · ${н}`);

if (process.argv.includes("--update")) {
  writeFileSync(ПЛАНКА, JSON.stringify({ допустимо: уник.length, список: уник }, null, 2) + "\n");
  console.log(`  планка записана: ${уник.length}`);
  process.exit(0);
}
if (!existsSync(ПЛАНКА)) {
  console.log("  ✗ ПРОВЕРКА НЕ ВЫПОЛНЕНА: нет планки — запустите с --update");
  process.exit(1);
}
const план = JSON.parse(readFileSync(ПЛАНКА, "utf-8"));
if (уник.length > план.допустимо) {
  console.log(`  ✗ нарушителей стало БОЛЬШЕ планки (${уник.length} > ${план.допустимо}) — новое мелкое поле`);
  process.exit(1);
}
if (уник.length < план.допустимо) {
  console.log(`  ✗ нарушений стало меньше (${уник.length} < ${план.допустимо}) — опустите планку тем же коммитом: --update`);
  process.exit(1);
}
console.log(`  ✓ ровно по планке (${план.допустимо}); цель — ноль`);
process.exit(0);
