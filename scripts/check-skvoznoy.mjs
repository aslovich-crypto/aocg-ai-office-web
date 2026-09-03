// ⚠️ СКВОЗНОЙ ПРИБОР (T135). Единственный прогон, проходящий путь ЦЕЛИКОМ:
// экран → настоящий HTTP → настоящий FastAPI → настоящий PostgreSQL → и
// обратно на экран. Ни одного стаба и ни одного двойника.
//
// ⚠️ ЗАЧЕМ, ЧИСЛОМ. Замер владельца 31.08.2026: дефектов, доехавших до прода,
// он нашёл глазами ШЕСТЬ, приборы — ОДИН. Причина родовая: backend-тесты шли
// на двойнике, `npm run behaviour` — на подставленных ответах, `look` — на
// отрисовке. Каждый прибор проверял свою половину против СВОИХ ЖЕ
// представлений о другой половине, и стык между ними не проверял никто.
//
// ⚠️ ДВЕ ПРОВЕРКИ, А НЕ ОДНА, И ЭТО ГЛАВНОЕ ЗДЕСЬ. «Экран показал чек» и
// «строка легла в базу» — разные утверждения, расходятся молча: оптимистичный
// список рисует то, что отправили, независимо от ответа сервера. Поэтому
// после сценария драйвер идёт В БАЗУ отдельным запросом и сверяет, что там
// лежит. Прибор, который верит экрану, повторил бы ошибку двойника.
//
// ⚠️ БЕЗ ПРИБОРОВ — КРАСНЫЙ, А НЕ ТИШИНА (T87). Нет PostgreSQL, нет venv
// бэкенда, нет Chrome — печатаем «ПРОВЕРКА НЕ ВЫПОЛНЕНА» и выходим с кодом 1.
// Пропущенный прогон, выглядящий зелёным, хуже отсутствующего прибора.
//
// ЗАПУСК: npm run skvoz     (бэкенд ищется рядом: ../aocg-ai-office,
//                            либо путь в AOCG_BACKEND)
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const КОРЕНЬ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ПРОБА = path.join(КОРЕНЬ, "scripts/probe-skvoz");
const БЭКЕНД =
  process.env.AOCG_BACKEND || path.resolve(КОРЕНЬ, "../aocg-ai-office");

// Порты случайные: с постоянными два прогона подряд дерутся за них.
const ПОРТ_ФРОНТ = 5300 + Math.floor(Math.random() * 200);
const ПОРТ_БЭК = 5600 + Math.floor(Math.random() * 200);

const БРАУЗЕРЫ = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];
// Серверные бинари PostgreSQL. Версионные каталоги ПЕРВЫМИ: `which initdb`
// на маке отвечает каталогом libpq, где нет ни postgres, ни pg_ctl.
const КАТАЛОГИ_PG = [
  "/opt/homebrew/opt/postgresql@18/bin",
  "/opt/homebrew/opt/postgresql@17/bin",
  "/opt/homebrew/opt/postgresql@16/bin",
  "/opt/homebrew/opt/postgresql/bin",
  "/usr/local/opt/postgresql@18/bin",
  "/usr/lib/postgresql/16/bin",
];

const ОЖИДАЕМО = [
  ["⓪ галочки отмечены", "обе отмечены"],
  ["⓪б согласие отправлено", "пройдено"],
  ["① экран чеков", "Чеки"],
  ["② открыт ввод чека", "сканер открыт"],
  ["③ ручной ввод", "реквизиты"],
  ["④ форма чека", "форма"],
  ["⑤ чек отправлен", "чек на экране"],
  ["⑥ экран отчётов", "Отчёты"],
  ["⑦ форма отчёта", "форма"],
  ["⑧ отчёт заполнен", "кнопка активна"],
  ["⑨ отчёт создан", "отчёт в списке"],
];

const беды = [];
console.log("\nСКВОЗНОЙ ПУТЬ: экран → сервер → база → экран (T135)");

function бинарьPG(имя) {
  for (const к of КАТАЛОГИ_PG) {
    const п = path.join(к, имя);
    if (existsSync(п)) return п;
  }
  return null;
}

function неВыполнена(текст, подсказки = []) {
  console.log(`  ✗ ПРОВЕРКА НЕ ВЫПОЛНЕНА: ${текст}`);
  подсказки.forEach((с) => console.log(`      ${с}`));
  process.exit(1);
}

// ─── приборы на месте? ──────────────────────────────────────────────────────
const браузер = БРАУЗЕРЫ.find((п) => existsSync(п));
if (!браузер) неВыполнена("не найден Chrome — кнопки жать нечем", БРАУЗЕРЫ);

const initdb = бинарьPG("initdb");
const pgCtl = бинарьPG("pg_ctl");
const psql = бинарьPG("psql");
if (!initdb || !pgCtl || !psql)
  неВыполнена("не найден PostgreSQL (initdb/pg_ctl/psql)", [
    "brew install postgresql@18",
    ...КАТАЛОГИ_PG,
  ]);

const питон = path.join(БЭКЕНД, "venv/bin/python");
if (!existsSync(питон))
  неВыполнена(`не найден бэкенд: ${питон}`, [
    "Ожидается репозиторий aocg-ai-office рядом с этим,",
    "или путь к нему в переменной AOCG_BACKEND.",
  ]);

// ─── временный PostgreSQL ───────────────────────────────────────────────────
// Каталог КОРОТКИЙ и в системном temp: путь unix-сокета ограничен 103 байтами,
// и длинный каталог роняет постмастер молча (замер 03.09.2026).
// LC_ALL обязателен: без валидной локали PG18 на macOS гаснет на старте
// с «postmaster became multithreaded during startup».
const базаКаталог = mkdtempSync(path.join(os.tmpdir(), "aocgskv-"));
const данные = path.join(базаКаталог, "d");
const окр = { ...process.env, LC_ALL: "C" };
let серверPG = false;
let бэк = null;
let фронт = null;

function прибрать() {
  if (фронт) фронт.kill("SIGKILL");
  if (бэк) бэк.kill("SIGKILL");
  if (серверPG)
    spawnSync(pgCtl, ["-D", данные, "-m", "immediate", "stop"], { env: окр });
  rmSync(базаКаталог, { recursive: true, force: true });
}
process.on("exit", прибрать);

const базовые = [
  "-D",
  данные,
  "-U",
  "postgres",
  "-A",
  "trust",
  "-E",
  "UTF8",
  "--no-sync",
  "--locale=C",
];
let р = spawnSync(
  initdb,
  [...базовые, "--locale-provider=builtin", "--builtin-locale=C.UTF-8"],
  { env: окр, encoding: "utf8" },
);
if (р.status !== 0) {
  rmSync(данные, { recursive: true, force: true });
  р = spawnSync(initdb, базовые, { env: окр, encoding: "utf8" });
}
if (р.status !== 0)
  неВыполнена(`initdb не поднял кластер: ${String(р.stderr).slice(-400)}`);

р = spawnSync(
  pgCtl,
  [
    "-D",
    данные,
    "-l",
    path.join(базаКаталог, "log"),
    "-o",
    `-c listen_addresses='127.0.0.1' -c port=${ПОРТ_БЭК + 1000} ` +
      `-c unix_socket_directories='${базаКаталог}' -c fsync=off`,
    "start",
  ],
  { env: окр, encoding: "utf8" },
);
if (р.status !== 0)
  неВыполнена(`PostgreSQL не стартовал: ${String(р.stderr).slice(-400)}`);
серверPG = true;

const адресБазы = `postgresql://postgres@127.0.0.1:${
  ПОРТ_БЭК + 1000
}/aocg_skvoz`;
р = spawnSync(
  psql,
  [
    "-h",
    "127.0.0.1",
    "-p",
    String(ПОРТ_БЭК + 1000),
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    "CREATE DATABASE aocg_skvoz",
  ],
  { env: окр, encoding: "utf8" },
);
if (р.status !== 0)
  неВыполнена(`база не создалась: ${String(р.stderr).slice(-400)}`);
console.log("  ✓ PostgreSQL поднят (временный, будет снесён)");

// ─── настоящий бэкенд ───────────────────────────────────────────────────────
// ⚠️ Почтовые переменные НЕ задаём намеренно: без них регистрация
// самоподтверждается (email_enabled() == false), и проба не упирается
// в письмо, которого никто не прочитает.
бэк = spawn(
  питон,
  [
    "-m",
    "uvicorn",
    "app.main:app",
    "--host",
    "127.0.0.1",
    "--port",
    String(ПОРТ_БЭК),
    "--log-level",
    "warning",
  ],
  {
    cwd: БЭКЕНД,
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      DATABASE_URL: адресБазы,
      JWT_SECRET_KEY: "probe-only-not-a-secret",
      SECURITY_ENFORCE_HTTPS: "false",
      APP_URL: `http://localhost:${ПОРТ_ФРОНТ}`,
      SENTRY_DSN: "",
    },
  },
);
let бэкОшибки = "";
бэк.stderr.on("data", (к) => (бэкОшибки += к));

// ⚠️ ЖДЁМ /health/db, А НЕ /health: liveness отвечает 200 и при мёртвой базе
// (на то она и liveness), и сценарий пошёл бы по неготовому серверу.
let живой = false;
for (let i = 0; i < 80 && !живой; i++) {
  await new Promise((г) => setTimeout(г, 250));
  try {
    живой = (await fetch(`http://127.0.0.1:${ПОРТ_БЭК}/health/db`)).ok;
  } catch {
    /* ещё не поднялся */
  }
}
if (!живой)
  неВыполнена("бэкенд не поднялся за 20 с", [
    ...String(бэкОшибки).split("\n").slice(-6),
  ]);
console.log("  ✓ бэкенд поднят, база отвечает (/health/db)");

// ─── проба фронта ───────────────────────────────────────────────────────────
try {
  execFileSync(
    path.join(КОРЕНЬ, "node_modules/.bin/vite"),
    ["build", "--config", path.join(ПРОБА, "vite.config.mjs")],
    {
      cwd: КОРЕНЬ,
      stdio: "pipe",
      timeout: 180000,
      env: { ...process.env, VITE_API_URL: `http://127.0.0.1:${ПОРТ_БЭК}` },
    },
  );
} catch (е) {
  неВыполнена(
    "проба не собралась",
    String(е.stdout || е.message)
      .split("\n")
      .slice(-6),
  );
}

фронт = spawn(
  path.join(КОРЕНЬ, "node_modules/.bin/vite"),
  [
    "preview",
    "--config",
    path.join(ПРОБА, "vite.config.mjs"),
    "--port",
    String(ПОРТ_ФРОНТ),
    "--strictPort",
  ],
  { cwd: КОРЕНЬ, stdio: "ignore" },
);
let поднялся = false;
for (let i = 0; i < 60 && !поднялся; i++) {
  await new Promise((г) => setTimeout(г, 250));
  try {
    поднялся = (await fetch(`http://localhost:${ПОРТ_ФРОНТ}/`)).ok;
  } catch {
    /* ещё не поднялся */
  }
}
if (!поднялся) неВыполнена("сервер пробы не поднялся за 15 с");

// ─── прогон сценария ────────────────────────────────────────────────────────
const снять_разом = () =>
  new Promise((готово, споткнулись) => {
    const дитя = spawn(
      браузер,
      [
        "--headless",
        "--disable-gpu",
        "--virtual-time-budget=40000",
        "--window-size=430,1400",
        "--dump-dom",
        `http://localhost:${ПОРТ_ФРОНТ}/`,
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let вывод = "";
    const часы = setTimeout(() => {
      дитя.kill("SIGKILL");
      споткнулись(new Error("браузер не ответил за 150 с"));
    }, 150000);
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

// ⚠️ ПЕРЕСНИМАЕМ ТОЛЬКО НЕСОСТОЯВШЕЕСЯ ИЗМЕРЕНИЕ (пустой замер, приложение
// не поднялось). Расхождение шагов не переснимается НИКОГДА — это результат.
let замер = null;
let ошибка = "";
try {
  for (let п = 0; п < 3 && !замер; п++) {
    const dom = await снять_разом();
    const р2 = разобрать(dom);
    if (Array.isArray(р2)) {
      замер = р2;
      if (п > 0)
        console.log(`  ⚠️ замер снялся только с попытки ${п + 1} из 3`);
    } else if (р2 && р2.НЕ_ОТРИСОВАЛОСЬ) {
      ошибка = `приложение не встало: ${р2.причина || "причина не названа"}`;
    } else {
      ошибка = "браузер не вернул замер";
    }
  }
} catch (е) {
  ошибка = String(е.message).slice(0, 300);
}
if (!замер) неВыполнена(ошибка);

console.log(`  шагов пройдено ${замер.length}`);
ОЖИДАЕМО.forEach(([имя, ждём], i) => {
  const целиком = String(замер[i] ?? "")
    .split(": ")
    .slice(1)
    .join(": ");
  // Слепок экрана идёт после « ~ » — он для чтения человеком, не для сверки.
  const [было, слепок] = целиком.split(" ~ ");
  const ок = было === ждём;
  console.log(
    `  ${ок ? "✓" : "✗"} ${имя}: ${было || "НЕТ"}${
      ок ? "" : `  ← ждали «${ждём}»`
    }`,
  );
  if (!ок) {
    беды.push(`${имя}: «${было || "НЕТ"}» вместо «${ждём}»`);
    if (слепок) console.log(`        на экране: ${слепок}`);
  }
});

// ─── ЧТО ЛЕГЛО В БАЗУ (отдельным запросом, не со слов экрана) ───────────────
const изБазы = (sql) => {
  const р3 = spawnSync(
    psql,
    [
      "-h",
      "127.0.0.1",
      "-p",
      String(ПОРТ_БЭК + 1000),
      "-U",
      "postgres",
      "-d",
      "aocg_skvoz",
      "-t",
      "-A",
      "-c",
      sql,
    ],
    { env: окр, encoding: "utf8" },
  );
  return String(р3.stdout || "").trim();
};

console.log("  В БАЗЕ (запрос к самой базе, а не со слов экрана):");
const проверки = [
  [
    "человек заведён",
    "SELECT count(*) FROM users WHERE email='skvoz@example.com'",
    "1",
  ],
  [
    "организация заведена",
    "SELECT count(*) FROM organizations WHERE name='ООО Сквозная'",
    "1",
  ],
  ["согласие записано", "SELECT count(*) FROM user_consents", "1"],
  [
    "чек записан",
    "SELECT count(*) FROM receipts WHERE org='ООО Сквозной Продавец'",
    "1",
  ],
  [
    "сумма чека верна",
    "SELECT COALESCE(max(amount)::text,'—') FROM receipts WHERE org='ООО Сквозной Продавец'",
    "1234.56",
  ],
  [
    "у чека есть автор",
    "SELECT count(*) FROM receipts WHERE org='ООО Сквозной Продавец' AND user_id IS NOT NULL",
    "1",
  ],
  [
    "отчёт записан",
    "SELECT count(*) FROM reports WHERE title='Сквозной отчёт'",
    "1",
  ],
];
проверки.forEach(([имя, sql, ждём]) => {
  const было = изБазы(sql);
  const ок = было === ждём;
  console.log(
    `  ${ок ? "✓" : "✗"} ${имя}: ${было || "пусто"}${
      ок ? "" : `  ← ждали «${ждём}»`
    }`,
  );
  if (!ок) беды.push(`база, ${имя}: «${было || "пусто"}» вместо «${ждём}»`);
});

if (беды.length) {
  // Журнал настоящего сервера — там видно 4xx/5xx, которых экран не показал.
  const хвост = String(бэкОшибки).trim().split("\n").slice(-6).filter(Boolean);
  if (хвост.length) {
    console.log("\n  ЖУРНАЛ БЭКЕНДА (последние строки):");
    хвост.forEach((с) => console.log(`     ${с.slice(0, 160)}`));
  }
  console.log(`\n  ⚠️ РАСХОЖДЕНИЙ ${беды.length}`);
  беды.forEach((б) => console.log(`     · ${б}`));
  process.exit(1);
}
console.log("\n  ✓ путь пройден целиком: экран → сервер → база → экран\n");
// ⚠️ ЯВНЫЙ ВЫХОД ОБЯЗАТЕЛЕН. Дети (uvicorn, vite preview, PostgreSQL) держат
// событийный цикл открытым, и УСПЕШНЫЙ прогон висел бы вечно — прибор,
// который не отпускает, хуже красного: в цепочке он вешает всё. Уборка
// стоит на process.on("exit") и отработает.
process.exit(0);
