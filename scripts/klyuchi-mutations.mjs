// ⚠️ МУТАЦИИ БЛОКА «КЛЮЧИ ДОСТУПА»: ломаем то, что сторож обязан поймать.
//
// Правило T11: зелёный сторож ничего не доказывает, пока не показано, что он
// умеет краснеть. Каждая правка ниже — отдельный дефект, каждый обязан дать
// красный `npm run klyuchi`. Файл возвращается в исходное состояние всегда,
// даже при падении.
//
// ЗАПУСК: node scripts/klyuchi-mutations.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const КОРЕНЬ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ФАЙЛ = path.join(КОРЕНЬ, "src/components/IntegrationKeys.jsx");

const МУТАЦИИ = [
  [
    "① блок показан сотруднику",
    'const видитСписок = админ || role === "accountant";',
    "const видитСписок = true;",
  ],
  [
    "② кнопка выпуска показана бухгалтеру",
    '  const админ = role === "admin";',
    '  const админ = role === "admin" || role === "accountant";',
  ],
  [
    "③ предупреждение про невосстановимость убрано",
    "Секрет ключа показывается один раз при выпуске и не восстанавливается —",
    "Ключ можно выпустить и отозвать.",
  ],
  [
    "④ секрет остаётся на экране после «Я скопировал»",
    "<Btn outline small onClick={() => setВыпущенный(null)}>",
    "<Btn outline small onClick={() => setВыпущенный(выпущенный)}>",
  ],
  [
    "⑤ отказ сервера при выпуске проглочен",
    '        setОшибка(\n          (тело && typeof тело.detail === "string" && тело.detail) ||\n            `Сервер ответил ${r.status}`,\n        );\n        return;',
    "        return;",
  ],
  [
    "⑥ сбой списка выдан за пустоту",
    "      .catch(() => setСбой(true));",
    "      .catch(() => setКлючи([]));",
  ],
  [
    // ⚠️ МУТАЦИЯ НА ШАГ ⑧ СТОРОЖА. Убираем ветку 404 — и «ключ уже отозван»
    // (обычное дело: отозвали с другого устройства) снова читается человеком
    // как поломка. Ветка есть в коде, но проверить её можно только прогоном:
    // условие «написано» и условие «срабатывает» — разные утверждения.
    "⑧ повторный отзыв снова выдан за ошибку",
    "      if (r.status === 404) {",
    "      if (false) {",
  ],
  [
    "⑦ срок и остаток дней не показаны",
    "          <div style={стиль.подпись}>{срокомСловами(к)}</div>",
    "          <div style={стиль.подпись} />",
  ],
];

const исходный = readFileSync(ФАЙЛ, "utf8");
const выжившие = [];

console.log("\nМУТАЦИИ БЛОКА КЛЮЧЕЙ: каждая обязана покраснеть\n");
try {
  for (const [имя, было, стало] of МУТАЦИИ) {
    if (!исходный.includes(было)) {
      console.log(`  ✗ ${имя}: ЯКОРЬ НЕ НАЙДЕН — мутация не применялась`);
      выжившие.push(имя + " (якорь)");
      continue;
    }
    writeFileSync(ФАЙЛ, исходный.replace(было, стало));
    let красный = false;
    try {
      execFileSync("node", [path.join(КОРЕНЬ, "scripts/check-klyuchi.mjs")], {
        cwd: КОРЕНЬ,
        stdio: "pipe",
        timeout: 600000,
      });
    } catch {
      красный = true;
    }
    console.log(
      `  ${красный ? "✓" : "✗"} ${имя}: ${красный ? "покраснел" : "ВЫЖИЛА"}`,
    );
    if (!красный) выжившие.push(имя);
  }
} finally {
  writeFileSync(ФАЙЛ, исходный);
}

if (выжившие.length) {
  console.log(`\n  ⚠️ ВЫЖИВШИХ ${выжившие.length}`);
  выжившие.forEach((в) => console.log(`     · ${в}`));
  process.exit(1);
}
console.log("\n  ✓ все мутации пойманы — сторож умеет краснеть\n");
