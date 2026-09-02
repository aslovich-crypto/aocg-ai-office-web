// Сторож T150: вперёд — с верха, назад — на прежнее место.
//
// ⚠️ ЗАЧЕМ ОН ЕСТЬ. Скроллер один на все экраны, и его позиция переживала
// смену экрана: прокрутил «Главную» — поиск «Профиля» рисовался под шапкой
// (верх −10 против ожидаемых 77). ТРИ захода искали причину в вёрстке
// полос, потому что ни одна проба не прокручивала перед переходом — а
// человек прокручивает всегда (класс T151). Этот сторож прокручивает.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const КОРЕНЬ = path.dirname(new URL(import.meta.url).pathname);
const БРАУЗЕРЫ = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];
const браузер = БРАУЗЕРЫ.find((п) => existsSync(п));

console.log("\nПРОКРУТКА ПРИ СМЕНЕ ЭКРАНА (T150, сценарий в живом приложении)");
if (!браузер) {
  console.log("  ✗ ПРОВЕРКА НЕ ВЫПОЛНЕНА: Chrome не найден");
  process.exit(1);
}
try {
  execFileSync("npx", ["vite", "build", "-c", path.join(КОРЕНЬ, "probe-pos/vite.config.mjs")], {
    stdio: "ignore",
  });
} catch {
  console.log("  ✗ ПРОВЕРКА НЕ ВЫПОЛНЕНА: проба не собралась");
  process.exit(1);
}

let замер = null;
for (let попытка = 0; попытка < 3 && !замер; попытка++) {
  const р = spawnSync(
    браузер,
    ["--headless", "--disable-gpu", "--allow-file-access-from-files",
     "--virtual-time-budget=25000", "--window-size=390,844", "--dump-dom",
     `file://${path.join(КОРЕНЬ, "probe-pos/__dist/index.html")}`],
    { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 },
  );
  const м = /<div id="ЗАМЕР">([\s\S]*?)<\/div>/.exec(р.stdout || "");
  if (м && м[1].trim()) {
    if (попытка > 0)
      console.log(`  ⚠️ замер снялся только с попытки ${попытка + 1} из 3`);
    замер = JSON.parse(м[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
  }
}
if (!замер) {
  console.log("  ✗ ПРОВЕРКА НЕ ВЫПОЛНЕНА: браузер не вернул замер за 3 попытки");
  process.exit(1);
}

const беды = [];
const г = замер["Главная"], п = замер["Профиль"];
if (!г || !п || г.ошибка || п.ошибка) {
  console.log("  ✗ ПРОВЕРКА НЕ ВЫПОЛНЕНА: поле поиска не найдено на одном из экранов");
  process.exit(1);
}
console.log(`  Главная: верх поля ${г.верх} · прокрутили до ${замер.скролл_перед_переходом}`);
console.log(`  Профиль после перехода: верх поля ${п.верх}`);
console.log(`  возврат на Главную: scrollTop ${замер.скролл_после_возврата}`);

// ① вперёд — с верха: поле «Профиля» на той же высоте, что «Главной» без прокрутки
if (Math.abs(п.верх - г.верх) > 2)
  беды.push(`вперёд НЕ с верха: Профиль ${п.верх}, ждали ~${г.верх} — чужая прокрутка пережила переход`);
// ② назад — на прежнее место
const ждали = замер.скролл_перед_переходом;
if (Math.abs((замер.скролл_после_возврата ?? -999) - ждали) > 2)
  беды.push(`назад НЕ на прежнее место: scrollTop ${замер.скролл_после_возврата}, ждали ~${ждали}`);

for (const б of беды) console.log(`  ✗ ${б}`);
if (!беды.length) console.log("  ✓ вперёд с верха, назад на прежнее место");
console.log(беды.length ? `  ⚠️ РАСХОЖДЕНИЙ ${беды.length}` : "  ИТОГ: прокрутка ведёт себя как ждёт человек");
process.exit(беды.length ? 1 : 0);
