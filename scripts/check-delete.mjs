// ⚠️ СТОРОЖ УДАЛЕНИЯ ЧЕКА: экран не говорит «удалено», когда чек не удалён.
//
// ЗАЧЕМ, ЗАМЕРОМ. `DELETE /api/receipts/{id}` отвечает 200 `{"ok": true}`
// ВСЕГДА — и когда чек удалён, и когда нет (анти-разведка, чужой чек обязан
// быть неотличим от несуществующего). Фронт считал успехом любой `res.ok` и
// убирал строку: бухгалтер удалял чужой чек, экран говорил «удалено», после
// перезагрузки чек был на месте. Расхождение экрана с базой — молчаливое.
//
// ⚠️ ПРОГОН ИДЁТ ПО ЭКРАНУ «ЧЕКИ», где человек нажимает, а не по тому месту,
// где механизм удобнее замерить (правило T165: прибор на «Сводке» уже
// оставлял зелёным неработающий экран «Чеки»).
//
// ЗАПУСК: npm run delete (нужен Chrome; без него — «ПРОВЕРКА НЕ ВЫПОЛНЕНА»).
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const КОРЕНЬ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ПРОБА = path.join(КОРЕНЬ, "scripts/probe-udalenie");
const ПОРТ = 5900 + Math.floor(Math.random() * 200);

const БРАУЗЕРЫ = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

const ОЖИДАЕМО = [
  ["① экран чеков", "Кофейня+Канцтовары+Такси+Аптека"],
  // Жест не делает необратимого: сначала вопрос, чек ещё на месте.
  ["② удаление спрашивает до жеста", "спрашивает · чек на месте"],
  ["③ подтверждённое удаление убирает строку", "строка убрана"],
  // ⚠️ ГЛАВНОЕ УТВЕРЖДЕНИЕ: 200 без удаления — не успех.
  ["④ «200 без удаления» не убирает строку", "чек на месте · сказано"],
  ["⑤ плашка не перекрывает шапку", "ниже шапки"],
  [
    "⑥ чек в отчёте предупреждает заранее",
    "назвал отчёт · без кнопки «Удалить»",
  ],
  ["⑦ отказ 409 не убирает строку", "чек на месте · текст сервера"],
];

const беды = [];
console.log("\nУДАЛЕНИЕ ЧЕКА: экран говорит правду о том, что произошло");

const браузер = БРАУЗЕРЫ.find((п) => existsSync(п));
if (!браузер) {
  console.log("  ✗ ПРОВЕРКА НЕ ВЫПОЛНЕНА: не найден Chrome — смотреть нечем");
  process.exit(1);
}

try {
  execFileSync(
    path.join(КОРЕНЬ, "node_modules/.bin/vite"),
    ["build", "--config", path.join(ПРОБА, "vite.config.mjs")],
    { cwd: КОРЕНЬ, stdio: "pipe", timeout: 180000 },
  );
} catch (е) {
  console.log("  ✗ ПРОВЕРКА НЕ ВЫПОЛНЕНА: проба не собралась");
  String(е.stdout || е.message)
    .split("\n")
    .slice(-6)
    .forEach((с) => console.log("      " + с));
  process.exit(1);
}

const сервер = spawn(
  path.join(КОРЕНЬ, "node_modules/.bin/vite"),
  [
    "preview",
    "--config",
    path.join(ПРОБА, "vite.config.mjs"),
    "--port",
    String(ПОРТ),
    "--strictPort",
  ],
  { cwd: КОРЕНЬ, stdio: "ignore" },
);

const снятьРазом = () =>
  new Promise((готово, споткнулись) => {
    const дитя = spawn(
      браузер,
      [
        "--headless",
        "--disable-gpu",
        "--virtual-time-budget=25000",
        "--window-size=430,1400",
        "--dump-dom",
        `http://localhost:${ПОРТ}/?rol=accountant`,
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let вывод = "";
    const часы = setTimeout(() => {
      дитя.kill("SIGKILL");
      споткнулись(new Error("браузер не ответил за 120 с"));
    }, 120000);
    дитя.stdout.on("data", (к) => (вывод += к));
    дитя.on("error", (е) => {
      clearTimeout(часы);
      споткнулись(е);
    });
    дитя.on("close", () => {
      clearTimeout(часы);
      готово(вывод);
    });
  });

const разобрать = (dom) => {
  const м = dom.match(/<div id="ЗАМЕР">([\s\S]*?)<\/div>/);
  if (!м || !м[1].trim()) return null;
  try {
    return JSON.parse(
      м[1]
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">"),
    );
  } catch {
    return null;
  }
};

try {
  let поднялся = false;
  for (let i = 0; i < 60 && !поднялся; i++) {
    await new Promise((г) => setTimeout(г, 250));
    try {
      поднялся = (await fetch(`http://localhost:${ПОРТ}/`)).ok;
    } catch {
      /* ещё не поднялся */
    }
  }
  if (!поднялся) throw new Error("сервер пробы не поднялся за 15 с");

  let замер = null;
  // Переснимаем только НЕСОСТОЯВШЕЕСЯ измерение; расхождение шага — результат.
  for (let п = 0; п < 3 && !замер; п++) {
    const р = разобрать(await снятьРазом());
    if (Array.isArray(р)) замер = р;
  }
  if (!замер) {
    console.log("  ✗ ПРОВЕРКА НЕ ВЫПОЛНЕНА: замер не снялся за 3 попытки");
    сервер.kill("SIGKILL");
    process.exit(1);
  }
  ОЖИДАЕМО.forEach(([имя, ждём], i) => {
    const было = String(замер[i] ?? "")
      .split(": ")
      .slice(1)
      .join(": ");
    const ок = было === ждём;
    console.log(
      `  ${ок ? "✓" : "✗"} ${имя}: ${было || "НЕТ"}${
        ок ? "" : `  ← ждали «${ждём}»`
      }`,
    );
    if (!ок) беды.push(`${имя}: «${было || "НЕТ"}» вместо «${ждём}»`);
  });
} catch (е) {
  console.log(`  ✗ ПРОВЕРКА НЕ ВЫПОЛНЕНА: ${String(е.message).slice(0, 200)}`);
  сервер.kill("SIGKILL");
  process.exit(1);
} finally {
  сервер.kill("SIGKILL");
}

if (беды.length) {
  console.log(`\n  ⚠️ РАСХОЖДЕНИЙ ${беды.length}`);
  беды.forEach((б) => console.log(`     · ${б}`));
  process.exit(1);
}
console.log(
  "\n  ✓ строка исчезает только при подтверждённом удалении; жест спрашивает,\n" +
    "    отчёт назван до жеста, плашка отказа не лежит на шапке\n",
);
process.exit(0);
