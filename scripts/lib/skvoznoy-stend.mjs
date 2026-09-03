// ⚠️ ОБЩИЙ СТЕНД ЖИВОГО ПУТИ: временный PostgreSQL + настоящий бэкенд +
// собранная проба фронта + прогон браузером. Выделен из check-skvoznoy.mjs
// 04.09.2026, когда понадобился ВТОРОЙ прибор (T152, протухание токена).
//
// ⚠️ ПОЧЕМУ ОБЩИЙ, А НЕ КОПИЯ. Копия стенда разошлась бы с оригиналом молча —
// ровно так уже разошлась копия скилла task-update, прожив полтора месяца
// (см. CLAUDE.md фронта). Здесь цена расхождения выше: два прибора мерили бы
// РАЗНЫЕ окружения, называя это одинаково.
//
// ⚠️ БЕЗ ПРИБОРОВ — КРАСНЫЙ, А НЕ ТИШИНА (T87): нет PostgreSQL, venv или
// Chrome — «ПРОВЕРКА НЕ ВЫПОЛНЕНА» и выход с кодом 1.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const КОРЕНЬ = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const БЭКЕНД =
  process.env.AOCG_BACKEND || path.resolve(КОРЕНЬ, "../aocg-ai-office");

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

export function неВыполнена(текст, подсказки = []) {
  console.log(`  ✗ ПРОВЕРКА НЕ ВЫПОЛНЕНА: ${текст}`);
  подсказки.forEach((с) => console.log(`      ${с}`));
  process.exit(1);
}

function бинарьPG(имя) {
  for (const к of КАТАЛОГИ_PG) {
    const п = path.join(к, имя);
    if (existsSync(п)) return п;
  }
  return null;
}

/**
 * Поднимает стенд целиком и возвращает ручки к нему.
 * @param {string} имяПробы — каталог пробы в scripts/ (например "probe-skvoz")
 */
export async function поднятьСтенд(имяПробы) {
  const ПРОБА = path.join(КОРЕНЬ, "scripts", имяПробы);
  // Порты случайные: с постоянными два прогона подряд дерутся за них.
  const ПОРТ_ФРОНТ = 5300 + Math.floor(Math.random() * 200);
  const ПОРТ_БЭК = 5600 + Math.floor(Math.random() * 200);
  const ПОРТ_БАЗЫ = ПОРТ_БЭК + 1000;

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

  // Каталог КОРОТКИЙ и в системном temp: путь unix-сокета ограничен
  // 103 байтами, длинный каталог роняет постмастер молча (замер 03.09.2026).
  // LC_ALL обязателен: без валидной локали PG18 на macOS гаснет на старте
  // с «postmaster became multithreaded during startup».
  const базаКаталог = mkdtempSync(path.join(os.tmpdir(), "aocgskv-"));
  const данные = path.join(базаКаталог, "d");
  const окр = { ...process.env, LC_ALL: "C" };
  let серверPG = false;
  let бэк = null;
  let фронт = null;

  const прибрать = () => {
    if (фронт) фронт.kill("SIGKILL");
    if (бэк) бэк.kill("SIGKILL");
    if (серверPG)
      spawnSync(pgCtl, ["-D", данные, "-m", "immediate", "stop"], { env: окр });
    rmSync(базаКаталог, { recursive: true, force: true });
  };
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
      `-c listen_addresses='127.0.0.1' -c port=${ПОРТ_БАЗЫ} ` +
        `-c unix_socket_directories='${базаКаталог}' -c fsync=off`,
      "start",
    ],
    { env: окр, encoding: "utf8" },
  );
  if (р.status !== 0) {
    // ⚠️ ПРИЧИНА ИЗ ЖУРНАЛА КЛАСТЕРА, А НЕ «Examine the log output».
    // pg_ctl отвечает отпиской, а настоящая причина лежит в его логе:
    // 04.09.2026 это был занятый порт (осиротевший кластер от прогона,
    // убитого SIGKILL), и по сообщению pg_ctl понять это было нельзя (T89).
    let журнал = "";
    try {
      журнал = readFileSync(path.join(базаКаталог, "log"), "utf8")
        .trim()
        .split("\n")
        .slice(-4)
        .join("\n");
    } catch {
      /* лога может не быть вовсе */
    }
    неВыполнена(
      `PostgreSQL не стартовал: ${String(р.stderr).trim().slice(-200)}`,
      [
        ...(журнал ? журнал.split("\n") : ["журнала кластера нет"]),
        "Если порт занят — посмотрите осиротевшие кластеры:",
        "  pgrep -lf 'postgres.*aocgskv'",
      ],
    );
  }
  серверPG = true;

  const адресБазы = `postgresql://postgres@127.0.0.1:${ПОРТ_БАЗЫ}/aocg_skvoz`;
  р = spawnSync(
    psql,
    [
      "-h",
      "127.0.0.1",
      "-p",
      String(ПОРТ_БАЗЫ),
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

  // ⚠️ Почтовые переменные НЕ задаём намеренно: без них регистрация
  // самоподтверждается (email_enabled() == false), и проба не упирается
  // в письмо, которого никто не прочитает.
  const СЕКРЕТ = "probe-only-not-a-secret";
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
        JWT_SECRET_KEY: СЕКРЕТ,
        SECURITY_ENFORCE_HTTPS: "false",
        APP_URL: `http://localhost:${ПОРТ_ФРОНТ}`,
        SENTRY_DSN: "",
      },
    },
  );
  let бэкОшибки = "";
  бэк.stderr.on("data", (к) => (бэкОшибки += к));

  // ⚠️ ЖДЁМ /health/db, А НЕ /health: liveness отвечает 200 и при мёртвой
  // базе (на то она и liveness), и сценарий пошёл бы по неготовому серверу.
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

  const снятьРазом = (хвост = "") =>
    new Promise((готово, споткнулись) => {
      const дитя = spawn(
        браузер,
        [
          "--headless",
          "--disable-gpu",
          "--virtual-time-budget=40000",
          "--window-size=430,1400",
          "--dump-dom",
          `http://localhost:${ПОРТ_ФРОНТ}/${хвост}`,
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

  /**
   * Снимает замер, переснимая ТОЛЬКО несостоявшееся измерение (пустой ответ,
   * приложение не встало). Расхождение шагов не переснимается НИКОГДА —
   * это результат, а не срыв.
   */
  const снять = async (хвост = "") => {
    let ошибка = "";
    for (let п = 0; п < 3; п++) {
      let dom;
      try {
        dom = await снятьРазом(хвост);
      } catch (е) {
        ошибка = String(е.message).slice(0, 300);
        continue;
      }
      const р2 = разобрать(dom);
      if (Array.isArray(р2)) {
        if (п > 0)
          console.log(`  ⚠️ замер снялся только с попытки ${п + 1} из 3`);
        return р2;
      }
      ошибка =
        р2 && р2.НЕ_ОТРИСОВАЛОСЬ
          ? `приложение не встало: ${р2.причина || "причина не названа"}`
          : "браузер не вернул замер";
    }
    неВыполнена(ошибка);
  };

  const изБазы = (sql) => {
    const р3 = spawnSync(
      psql,
      [
        "-h",
        "127.0.0.1",
        "-p",
        String(ПОРТ_БАЗЫ),
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

  /** Запускает python бэкенда с его venv — нужен, например, чтобы выпустить
   *  ЗАВЕДОМО ПРОТУХШИЙ токен тем же секретом, что и живой сервер. */
  const питономБэка = (код) => {
    const р4 = spawnSync(питон, ["-c", код], {
      cwd: БЭКЕНД,
      encoding: "utf8",
      env: { ...process.env, JWT_SECRET_KEY: СЕКРЕТ, DATABASE_URL: адресБазы },
    });
    if (р4.status !== 0)
      неВыполнена(
        `python бэкенда споткнулся: ${String(р4.stderr).slice(-300)}`,
      );
    return String(р4.stdout || "").trim();
  };

  return {
    портФронта: ПОРТ_ФРОНТ,
    портБэка: ПОРТ_БЭК,
    адресБэка: `http://127.0.0.1:${ПОРТ_БЭК}`,
    снять,
    изБазы,
    питономБэка,
    журналБэка: () => String(бэкОшибки),
  };
}

/** Печатает шаги и копит расхождения. Слепок экрана идёт после « ~ ». */
export function сверитьШаги(замер, ожидаемо, беды) {
  console.log(`  шагов пройдено ${замер.length}`);
  ожидаемо.forEach(([имя, ждём], i) => {
    const целиком = String(замер[i] ?? "")
      .split(": ")
      .slice(1)
      .join(": ");
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
}

/** Итог прогона: журнал сервера при расхождениях + честный код выхода. */
export function итог(беды, журнал, успех) {
  if (беды.length) {
    const хвост = String(журнал).trim().split("\n").slice(-6).filter(Boolean);
    if (хвост.length) {
      console.log("\n  ЖУРНАЛ БЭКЕНДА (последние строки):");
      хвост.forEach((с) => console.log(`     ${с.slice(0, 160)}`));
    }
    console.log(`\n  ⚠️ РАСХОЖДЕНИЙ ${беды.length}`);
    беды.forEach((б) => console.log(`     · ${б}`));
    process.exit(1);
  }
  console.log(`\n  ✓ ${успех}\n`);
  // ⚠️ ЯВНЫЙ ВЫХОД ОБЯЗАТЕЛЕН: дети (uvicorn, vite, PostgreSQL) держат
  // событийный цикл, и УСПЕШНЫЙ прогон висел бы вечно. Уборка стоит
  // на process.on("exit") и отработает.
  process.exit(0);
}
