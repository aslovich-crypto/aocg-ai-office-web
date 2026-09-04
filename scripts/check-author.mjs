// ⚠️ СТОРОЖ АВТОРА ЧЕКА: показ и отбор на ОДНОМ поле (04.09.2026).
//
// ЗАЧЕМ, ЗАМЕРОМ. На проде в 88 чеках колонка `employee` пуста во всех,
// а `user_id` заполнен во всех. Фронт подставлял вместо пустоты жёстко
// вписанное имя владельца (`r.employee || "Алексей Шукалович"`), и это давало
// два следствия: на «Сводке» ВСЕ расходы организации складывались в одного
// человека, а фильтр «Сотрудник» по любому другому имени давал пустой список
// ВСЕГДА — сравнивалась подставленная строка, а не автор.
//
// ⚠️ ЖИВЫЕ ДАННЫЕ ЭТОГО НЕ ПОКАЖУТ: у всех чеков прода один автор, и экран
// после правки выглядит почти так же. Поэтому проверка — здесь, на данных
// ДВУХ авторов и одного чека без автора, а не «посмотрел глазами».
//
// ЗАПУСК: npm run author (нужен Chrome; без него — «ПРОВЕРКА НЕ ВЫПОЛНЕНА»).
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const КОРЕНЬ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ПРОБА = path.join(КОРЕНЬ, "scripts/probe-avtor");
const ПОРТ = 5700 + Math.floor(Math.random() * 200);

const БРАУЗЕРЫ = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

// Ожидания по ролям. Ключевое утверждение — второе: сотрудник подписей
// не видит, потому что список у него и так свой (решение владельца).
// Прогоны: два по чекам (роль решает, видна ли подпись) и один по «Сводке»,
// где живёт фильтр «Сотрудник» и разрез сумм по авторам.
const ПРОГОНЫ = [
  { имя: "чеки · admin", хвост: "?rol=admin", шаги: "cheki_admin" },
  { имя: "чеки · employee", хвост: "?rol=employee", шаги: "cheki_employee" },
  {
    имя: "сводка · admin",
    хвост: "?rol=admin&rezhim=svodka",
    шаги: "svodka",
  },
];

const ОЖИДАЕМО = {
  cheki_admin: [
    ["① экран чеков", "admin · Кофейня+Канцтовары+Такси"],
    ["② подпись автора в списке", "Шукалович А.+Иванова Т."],
    ["③ автор в карточке чужого чека", "Иванова Т."],
    ["④ закрыта карточка", "список"],
    ["⑤ автор у чека без user_id", "Автор не указан"],
  ],
  cheki_employee: [
    ["① экран чеков", "employee · Кофейня+Канцтовары+Такси"],
    ["② подпись автора в списке", "нет подписей"],
    ["③ автор в карточке чужого чека", "Иванова Т."],
    ["④ закрыта карточка", "список"],
    ["⑤ автор у чека без user_id", "Автор не указан"],
  ],
  svodka: [
    ["① экран сводки", "admin · открыта"],
    // Разрез строится по автору, поэтому в нём оба человека и ничейный чек.
    ["② разрез по авторам", "Шукалович А.+Иванова Т.+Автор не указан"],
    ["③ открыт фильтр", "фильтр открыт"],
    // ⚠️ ГЛАВНОЕ УТВЕРЖДЕНИЕ ПРАВКИ, обе половины.
    ["④а отмечен сотрудник БЕЗ чеков", "отмечен"],
    ["④б применён фильтр", "пусто"],
    ["⑤а переоткрыт фильтр", "фильтр открыт"],
    ["⑤б отмечен сотрудник С чеками", "отмечен"],
    // ⚠️ РОВНО ЕГО ЧЕК, а не «хоть что-то»: у Ивановой один чек — «Канцтовары».
    ["⑤в применён фильтр", "Канцтовары"],
  ],
};

const беды = [];
console.log("\nАВТОР ЧЕКА: показ и отбор на одном поле");

const браузер = БРАУЗЕРЫ.find((п) => existsSync(п));
if (!браузер) {
  console.log("  ✗ ПРОВЕРКА НЕ ВЫПОЛНЕНА: не найден Chrome — смотреть нечем");
  БРАУЗЕРЫ.forEach((п) => console.log(`      ${п}`));
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

const снятьРазом = (хвост) =>
  new Promise((готово, споткнулись) => {
    const дитя = spawn(
      браузер,
      [
        "--headless",
        "--disable-gpu",
        "--virtual-time-budget=25000",
        "--window-size=430,1400",
        "--dump-dom",
        `http://localhost:${ПОРТ}/${хвост}`,
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

  for (const прогон of ПРОГОНЫ) {
    console.log(`\n  ${прогон.имя.toUpperCase()}`);
    let замер = null;
    // ⚠️ Переснимаем только НЕСОСТОЯВШЕЕСЯ измерение (пусто, приложение
    // не встало). Расхождение шага — это результат, его не переснимают.
    for (let п = 0; п < 3 && !замер; п++) {
      const р = разобрать(await снятьРазом(прогон.хвост));
      if (Array.isArray(р)) замер = р;
    }
    if (!замер) {
      console.log("  ✗ ПРОВЕРКА НЕ ВЫПОЛНЕНА: замер не снялся за 3 попытки");
      process.exitCode = 1;
      continue;
    }
    ОЖИДАЕМО[прогон.шаги].forEach(([имя, ждём], i) => {
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
      if (!ок)
        беды.push(`${прогон.имя}/${имя}: «${было || "НЕТ"}» вместо «${ждём}»`);
    });
  }
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
  "\n  ✓ автор берётся из user_id, подписи по роли, «Автор не указан» на месте\n",
);
process.exit(0);
