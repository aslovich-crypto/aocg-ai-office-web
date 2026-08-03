#!/usr/bin/env node
// Автоматический прогон вёрстки по ширинам (задача T15, разовый инструмент).
//
// Что делает: поднимает браузер, логинится, обходит 16 сочетаний
// «ширина × экран» и на каждом снимает ВСЕ показания сторожа переполнения
// плюс скриншот. Показания берутся значениями из window.__overflowScan —
// той же функции, что питает красную панель. Текст панели не разбирается
// и логика сканирования не дублируется: копия разошлась бы с оригиналом.
//
// ГРАНИЦЫ ИНСТРУМЕНТА — см. README.md, раздел «Чего инструмент не даёт».
// Коротко: headless Chromium это не Safari на iPhone.

import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, "..", "..");
const OUT = join(HERE, "out");

// ── настройки ────────────────────────────────────────────────────────────────
const SIZES = [
  { w: 320, h: 568 }, // iPhone SE — самый узкий из реальных
  { w: 360, h: 780 },
  { w: 375, h: 667 },
  { w: 430, h: 932 }, // iPhone Pro Max в штатном масштабе
];
const SCREENS = [
  { id: "glavnaya", nav: "Главная", scroll: false },
  { id: "svodka", nav: "Сводка", scroll: false },
  { id: "operacii", nav: "Чеки", scroll: true },
  { id: "otchety", nav: "Отчёты", scroll: true },
];
// Кнопка прячется при прокрутке и возвращается через 220мс покоя (c85cb6e).
// Меряем ПОСЛЕ возврата: иначе кадр покажет пустоту и мы решим, что
// перекрытий нет, — а нас интересует именно худший случай.
const FAB_RETURN_MS = 500;

// ── .env без зависимостей ────────────────────────────────────────────────────
function loadEnv() {
  for (const f of [join(WEB, ".env"), join(HERE, ".env")]) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]])
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

const git = (repo, cmd) => {
  try {
    return execSync(`git -C "${repo}" ${cmd}`, { encoding: "utf8" }).trim();
  } catch {
    return "—";
  }
};

// ── прогон ───────────────────────────────────────────────────────────────────
loadEnv();
const URL_BASE = (process.env.AUDIT_URL || "http://localhost:4173").replace(
  /\/$/,
  "",
);
const EMAIL = process.env.AUDIT_EMAIL;
const PASSWORD = process.env.AUDIT_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error(
    "\n✖ Нет AUDIT_EMAIL / AUDIT_PASSWORD. Заполните .env по образцу .env.example.\n" +
      "  Креды в git не попадают: .env в .gitignore.\n",
  );
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: "ru-RU" });
const page = await ctx.newPage();

// Согласие проставляем в хранилище, а не кликами: экран согласия — не предмет
// этого прогона, а два чекбокса на 16 заходов только добавили бы хрупкости.
await page.addInitScript(() => {
  try {
    localStorage.setItem("consent_given", "true");
  } catch {
    /* private mode */
  }
});

// Ответы на вход копим С МОМЕНТА ЗАПУСКА, а не спрашиваем задним числом.
// Так было нельзя: waitForResponse ждёт ответ, который придёт В БУДУЩЕМ, —
// а ответ сервера прилетает через ~1 сек после клика, тогда как разбор
// начинается через 20 сек, по таймауту ожидания. Слушать начинали на 19 сек
// позже события, вердикт получался ОБРАТНЫЙ: «форма не ушла, дело в скрипте»
// при честном 401 от сервера. Слушатель вешается один раз, до всякого клика.
const loginCalls = [];
page.on("response", (r) => {
  if (r.url().includes("/api/auth/login"))
    loginCalls.push({ status: r.status() });
});

// Разбор накопленного. Смысл различения: «сервер отверг» и «форма не ушла»
// на экране выглядят одинаково, а лечатся противоположно — первое правится
// в .env, второе в скрипте.
//
// Про 429 отдельно: он не только диагноз, но и ДОКАЗАТЕЛЬСТВО доставки.
// Бэкенд считает неудачные попытки и после пятой закрывает вход на 15 минут
// (failed_attempts / locked_until). Счётчик растёт ТОЛЬКО от реально
// полученных запросов — значит рост счётчика (или пришедший 429) означает,
// что форма уходит, и разбирать надо креды, а не кнопку. Обратное тоже
// работает: счётчик стоит на месте — запросы не доходят.
// Цена признака: каждый прогон с неверным паролем приближает блокировку.
function loginVerdict() {
  const last = loginCalls.at(-1);
  if (!last)
    return (
      "запроса на /api/auth/login НЕ БЫЛО → форма не ушла. Дело не в кредах: " +
      "либо значения не дошли до состояния формы (submit() молча выходит " +
      "на пустых полях), либо кнопка не нажалась. Правьте скрипт"
    );
  if (last.status === 429)
    return (
      "сервер ответил 429 → блокировка или лимит по IP. Попутно доказано, " +
      "что запросы ДОХОДЯТ (счётчик неудачных попыток растёт только от " +
      "реально полученных запросов). Подождите и проверьте креды"
    );
  if (last.status >= 400)
    return `сервер ОТВЕРГ: ${last.status} на /api/auth/login → правьте AUDIT_EMAIL/AUDIT_PASSWORD в .env`;
  return (
    `сервер ПРИНЯЛ (${last.status}), но форма осталась на экране → дело не ` +
    "во входе, а в переключении интерфейса. Правьте скрипт или смотрите приложение"
  );
}

async function login() {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto(URL_BASE, { waitUntil: "networkidle" });
  const inputs = page.locator(".aocg-login-input");
  if ((await inputs.count()) === 0) return "уже был авторизован";

  // ПЕЧАТАЕМ, А НЕ ПОДСТАВЛЯЕМ. fill() ставит значение одним присваиванием;
  // если оно совпало с прежним (повторный запуск после ошибки), React может
  // не увидеть изменения, кнопка останется заблокированной и форма просто
  // не уйдёт. Внешне это неотличимо от неверного пароля — на чём мы
  // и застряли: сообщение об ошибке висело от прошлой попытки, а счётчик
  // неудачных входов на сервере не рос.
  const type = async (loc, value) => {
    await loc.click();
    await loc.fill("");
    await loc.pressSequentially(value, { delay: 15 });
  };
  await type(inputs.nth(0), EMAIL);
  await type(inputs.nth(1), PASSWORD);

  // Кнопка неактивна — значит форма не считает данные валидными.
  // Жать вслепую бессмысленно и тратит попытку входа.
  const submit = page.locator(".aocg-login-submit");
  if (await submit.isDisabled()) {
    await page.screenshot({ path: join(OUT, "login-failed.png") });
    throw new Error(
      "кнопка «Войти» неактивна — форма не приняла введённое.\n" +
        `  Проверьте AUDIT_EMAIL и AUDIT_PASSWORD в .env.\n` +
        `  Скриншот: ${join(OUT, "login-failed.png")}`,
    );
  }
  await submit.click();
  try {
    await page.waitForSelector(".aocg-login-input", {
      state: "detached",
      timeout: 20000,
    });
  } catch {
    // Слепой таймаут ничего не объясняет. Забираем то, что показывает
    // сама страница: приложение отвечает человеческим текстом («Неверный
    // логин или пароль», «Слишком много запросов»), и он и есть диагноз.
    const texts = await page.evaluate(() =>
      [...document.querySelectorAll("div,span,p")]
        .filter((e) => {
          const t = (e.textContent || "").trim();
          return (
            t.length > 5 &&
            t.length < 160 &&
            e.children.length === 0 &&
            /невер|ошиб|паро|блок|попыт|много|связ|сервер|не удалось/i.test(t)
          );
        })
        .map((e) => e.textContent.trim()),
    );
    await page.screenshot({ path: join(OUT, "login-failed.png") });
    throw new Error(
      "вход не выполнен. Страница говорит: " +
        (texts.length ? [...new Set(texts)].join(" | ") : "ничего не сказала") +
        `\n  Диагноз: ${loginVerdict()}` +
        `\n  Запросов на /api/auth/login: ${loginCalls.length}` +
        (loginCalls.length
          ? ` (ответы: ${loginCalls.map((c) => c.status).join(", ")})`
          : "") +
        `\n  Скриншот: ${join(OUT, "login-failed.png")}` +
        `\n  Адрес: ${URL_BASE}`,
    );
  }
  return "вход выполнен";
}

// Открыть страницу С МЕТКОЙ и убедиться, что диагностика поднялась.
//
// ПОЧЕМУ ЧЕРЕЗ ПЕРЕЗАГРУЗКУ: переход на тот же адрес с другим якорем
// НЕ перезагружает страницу — браузер лишь меняет фрагмент. А
// initOverflowDebug() читает метку ОДИН РАЗ при загрузке модуля, поэтому
// после такого перехода диагностики нет вовсе. На устройстве это незаметно:
// человек вводит адрес с меткой и жмёт ввод, то есть грузит страницу заново.
// Мы на этом застряли: самопроверка отрапортовала «проба не ловится», хотя
// ловить было нечем — сторож не запускался. Красный результат без проверки
// того, что проверка вообще выполнилась, ничего не значит (правило T11).
async function openWithMark(mark) {
  await page.goto(`${URL_BASE}/#${mark}`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "networkidle" });
  const ready = await page.evaluate(
    () => typeof window.__overflowScan === "function",
  );
  if (!ready)
    throw new Error(
      `диагностика не поднялась на #${mark}: window.__overflowScan отсутствует.\n` +
        "  Прод отдаёт бандл без неё — проверьте, что коммит с __overflowScan задеплоен.",
    );
}

// САМОПРОВЕРКА ПО T11. Тонкая проба +5px, НЕ грубая +120px: грубая
// доказывает лишь то, что грубый случай ловится — мы это уже проходили,
// когда сторож пропускал реальные 30-40px и ловил синтетические 120.
async function selfCheck() {
  await page.setViewportSize({ width: 375, height: 667 });
  await openWithMark("overflow-test-thin");
  await page.waitForTimeout(1600); // проба вставляется через 800мс
  const r = await page.evaluate(() => window.__overflowScan?.());
  const found = (r?.cutoff || []).some((c) => /ПРОБА/.test(c.el));
  return { ok: found, cutoff: r?.cutoff?.length ?? "нет данных" };
}

async function gotoScreen(nav) {
  await openWithMark("overflow");
  await page.getByRole("button", { name: nav, exact: true }).first().click();
  await page.waitForTimeout(600);
}

const scrollTo = (frac) =>
  page.evaluate((f) => {
    const el = [...document.querySelectorAll("div")].find(
      (d) => d.scrollHeight > d.clientHeight + 10 && d.clientHeight > 200,
    );
    if (el) el.scrollTop = (el.scrollHeight - el.clientHeight) * f;
  }, frac);

const measure = () => page.evaluate(() => window.__overflowScan());
const withText = (m) =>
  (m.overlap || []).flatMap((o) => o.covered.filter((c) => c.leaf));

const rows = [];
const details = [];
console.log("вход:", await login());
const self = await selfCheck();
console.log(
  `самопроверка T11 (+5px): ${self.ok ? "ловится ✓" : "НЕ ЛОВИТСЯ ✗"}`,
);
if (!self.ok) {
  console.error(
    "\n✖ Тонкая проба не поймана. Показания сторожа, который не проверен,\n" +
      "  не стоят бумаги — таблицу не печатаю.\n",
  );
  await browser.close();
  process.exit(1);
}

for (const s of SCREENS) {
  for (const size of SIZES) {
    await page.setViewportSize({ width: size.w, height: size.h });
    await gotoScreen(s.nav);
    const spots = s.scroll
      ? [
          ["верх", 0],
          ["середина", 0.5],
          ["низ", 1],
        ]
      : [["—", 0]];
    const acc = [];
    for (const [name, frac] of spots) {
      if (frac) await scrollTo(frac);
      await page.waitForTimeout(frac ? FAB_RETURN_MS : 200);
      const m = await measure();
      acc.push({ name, m });
      const shot = `${s.id}-${size.w}${frac ? "-" + name : ""}.png`;
      await page.screenshot({ path: join(OUT, shot) });
    }
    const worst = (key) => Math.max(...acc.map((a) => a.m[key].length));
    const overText = Math.max(...acc.map((a) => withText(a.m).length));
    rows.push({
      screen: s.id,
      w: size.w,
      doc: acc[0].m.doc,
      scr: acc[0].m.screen,
      boundary: worst("boundary"),
      outgrow: worst("outgrow"),
      clip: worst("clip"),
      cutoff: worst("cutoff"),
      overText,
    });
    for (const a of acc) {
      const t = withText(a.m);
      if (
        a.m.boundary.length ||
        a.m.outgrow.length ||
        a.m.cutoff.length ||
        t.length
      )
        details.push({
          screen: s.id,
          w: size.w,
          spot: a.name,
          boundary: a.m.boundary,
          outgrow: a.m.outgrow,
          cutoff: a.m.cutoff,
          covered: t,
          onTop: (a.m.overlap || []).map((o) => o.onTop),
        });
    }
    process.stdout.write(`  ${s.id} @${size.w} готово\n`);
  }
}
await browser.close();

// ── отчёт ────────────────────────────────────────────────────────────────────
const bad = (r) =>
  r.doc > r.scr || r.boundary || r.outgrow || r.clip || r.cutoff || r.overText;
const cell = (r) =>
  (bad(r) ? "⚠ " : "") +
  `${r.doc}/${r.scr}` +
  ` · ${r.boundary}/${r.outgrow}/${r.clip}/${r.cutoff}/${r.overText}`;

let md = `# Прогон вёрстки по ширинам\n\n`;
md += `- дата: ${new Date().toISOString().slice(0, 16).replace("T", " ")}\n`;
md += `- гнали против: ${URL_BASE}${
  URL_BASE.includes("localhost") ? " (локальная сборка)" : " (AUDIT_URL)"
}\n`;
// Формат В КАВЫЧКАХ. Без них «%s» уезжает отдельным аргументом, git считает
// его ревизией и падает («ambiguous argument '%s'»), catch подставляет «—» —
// и обе строки HEAD во ВСЕХ отчётах были «—». То есть архив прогонов не знал,
// против какого кода снят, ради чего эти строки и заводились.
md += `- фронт HEAD: ${git(WEB, 'log -1 --format="%h %s"')}\n`;
md += `- бэк HEAD: ${git(
  join(WEB, "..", "aocg-ai-office"),
  'log -1 --format="%h %s"',
)}\n`;
md += `- самопроверка T11 (тонкая проба +5px): ${
  self.ok ? "ловится ✓" : "НЕ ЛОВИТСЯ ✗"
}\n\n`;
md += `Ячейка: \`документ/экран · вылезли(первопричин)/шире родителя/обрезано/срезан предком/перекрыто С ТЕКСТОМ\`.\n`;
md += `Для «Чеков» и «Отчётов» берётся ХУДШЕЕ из трёх положений прокрутки.\n`;
md += `Пустые оболочки в перекрытиях не считаются.\n\n`;
md += `| экран | ${SIZES.map((s) => s.w).join(" | ")} |\n`;
md += `| --- | ${SIZES.map(() => "---").join(" | ")} |\n`;
for (const s of SCREENS) {
  const cells = SIZES.map((z) => {
    const r = rows.find((x) => x.screen === s.id && x.w === z.w);
    return r ? cell(r) : "—";
  });
  md += `| ${s.nav} | ${cells.join(" | ")} |\n`;
}
if (details.length) {
  md += `\n## Что именно нашлось\n\n`;
  for (const d of details) {
    md += `**${d.screen} @${d.w}${d.spot !== "—" ? ", " + d.spot : ""}**\n\n`;
    const list = (t, a, f) =>
      a.length ? `- ${t}: ` + a.map(f).join("; ") + "\n" : "";
    md += list("вылезли за экран", d.boundary, (x) => `+${x.px}px ${x.el}`);
    md += list("шире родителя", d.outgrow, (x) => `+${x.px}px ${x.el}`);
    md += list(
      "срезан предком",
      d.cutoff,
      (x) => `−${x.px}px ${x.el} ← режет ${x.clipper}`,
    );
    md += list("перекрыто с текстом", d.covered, (x) => `−${x.px}px ${x.el}`);
    if (d.onTop.length)
      md += `- сверху в центре плавающего: ${d.onTop.join(", ")}\n`;
    md += "\n";
  }
} else {
  md += `\n## Что именно нашлось\n\nНичего: все счётчики нулевые на всех ширинах.\n`;
}
md += `\n## Чего этот отчёт НЕ доказывает\n\n`;
md += `Счётчики отражают ГЕОМЕТРИЮ. Композицию, читаемость и то, что экран\n`;
md += `«выглядит нормально», оценивает человек по скриншотам в этой же папке.\n`;
md += `Полный список ограничений — в README.md.\n`;

writeFileSync(join(OUT, "report.md"), md);
console.log(`\nотчёт: ${join(OUT, "report.md")}`);
console.log(
  `скриншотов: ${rows.length + rows.filter((r) => r.overText >= 0).length}`,
);
