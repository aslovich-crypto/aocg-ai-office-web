// ИЗМЕРИТЕЛЬ, КОТОРЫЙ ДОКАЗЫВАЕТ, ЧТО ПОМЕРИЛ ТО, ЧТО ДУМАЕТ (задача T26).
//
// ЗАЧЕМ. Замер выдаёт ЧИСЛО, а число выглядит фактом независимо от того, что
// мерили. За два дня измеритель соврал пять раз, и каждый раз его ловили
// вручную и по одному разу:
//   ① 03.08 ширину мерили скрытой пробой, которая взяла шрифт ДОКУМЕНТА,
//      а не элемента: 47.2px вместо 41.0. Поймал скриншот.
//   ② 05.08 элемент искали по координате — выбрался сосед: «transform: none»
//      при работающем свайпе. Поймала пометка data-dbg.
//   ③ 06.08 скрипт кликал в строку, открытую свайпом, по отрицательному X:
//      клик уходил мимо, жест не сбрасывался.
//   ④ 06.08 разбор markdown резал строку по каждому «|», включая
//      ЭКРАНИРОВАННЫЙ, и объявил целую строку побитой. Это не про браузер —
//      см. «ЧЕГО ЭТОТ МОДУЛЬ НЕ ЛОВИТ» ниже.
//   ⑤ 06.08 мутация ставила пробу блоком, та уходила на новую строку —
//      стенд краснел, но с НЕВЕРНЫМ диагнозом.
//   ⑥ 07.08 сам этот модуль: `{тег:"button", индекс:0}` выбрал переключатель
//      приложений 38×38 вместо плавающей кнопки 56×56. Паспорт промах
//      показал, а pick пропустил — индекс снимает защиту «ровно один
//      кандидат». Отсюда правило ниже: ИНДЕКС ТРЕБУЕТ СИЛЬНОГО ОЖИДАНИЯ,
//      и оно проверяется В КОДЕ, а не советом в комментарии.
//
// ПРИНЦИП. Любой замер проходит через pick(), а pick() не возвращает элемент
// молча: он требует ЯВНОГО ОЖИДАНИЯ («я мерю div со шрифтом 400 13px, текст
// начинается с даты»), падает при несовпадении и ВСЕГДА печатает паспорт
// выбранного — тег, свой текст, шрифт, координаты.
//
// ПАСПОРТ ПЕЧАТАЕТСЯ ВСЕГДА, БЕЗ ФЛАГА «ПОДРОБНО» — это не многословность,
// а конструкция. Флаг выключат через месяц ради краткости вывода, и мы
// вернёмся ровно туда, откуда пришли: к числу без предъявленного источника.
//
// ═══ ПОЧЕМУ ТРИ ПАРАМЕТРА, А НЕ АДАПТЕР, И ПОЧЕМУ МОДУЛЬ ОДИН НА ДВА
// ═══ ПРИЛОЖЕНИЯ — ЧИТАТЬ ДО ТОГО, КАК «УПРОЩАТЬ»
//
// Приложений у нас два: Прима (телефон, нижнее меню) и Финансы (десктоп, своя
// навигация, ручки /api/finance/*). Мерить в них надо ОДНО И ТО ЖЕ: геометрию,
// переполнения, соответствие макету. Поэтому ядро — pick/measure/textWidth/tap —
// про приложения не знает ничего, там только DOM, шрифты и координаты.
//
// К приложению привязаны ровно три вещи, и они вынесены ПАРАМЕТРАМИ
// с умолчаниями Примы: как ВОЙТИ (login), как ПЕРЕЙТИ на экран (goto)
// и по чему понять, что ДАННЫЕ ПРИШЛИ (gate). Финансам это будет объект
// на десять строк рядом со скриптом замера — без нового слоя абстракции.
//
// Адаптер-фреймворк не пишем сознательно: пока профиль один, реестр профилей —
// это папка ради папки. Появится второй — заведём файл на два объекта.
//
// А ВОТ ЧЕГО ДЕЛАТЬ НЕЛЬЗЯ: заводить `tools/finance-audit/` со «своим»
// измерителем. Это буквально место, где заведётся вторая копия pick() —
// и разойдётся с этой молча, как уже разошлись палитра дизайн-системы
// и четыре копии форматирования денег. Финансы живут в ЭТОМ репозитории
// (`src/finance/`), инструменты у нас общие по факту: `npm run lint` ходит
// по всему `src/`. Один модуль, три параметра — дешевле любой копии.
//
// ЧЕГО ЭТОТ МОДУЛЬ НЕ ЛОВИТ (называю сразу, чтобы не считали его щитом):
//   • «померил НЕ ТАК» при верном элементе — неверная методика, формула,
//     ширина экрана. Паспорт покажет, ЧТО измерено, но не рассудит, верно ли;
//   • разбор текстовых форматов вне браузера (случай ④) — там нужна проверка
//     разбора на контрольном примере, отдельная привычка (задача T30);
//   • отличия headless Chromium от Safari на устройстве и лимит запросов
//     прода (T23).

import { chromium } from "playwright";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, "..", "..");
const OUT = join(HERE, "out", "probe");

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

// Регулярку через page.evaluate целиком не передать — разбираем на части.
const reWire = (re) =>
  re instanceof RegExp ? { source: re.source, flags: re.flags } : null;

function shotPath(name) {
  mkdirSync(OUT, { recursive: true });
  return join(OUT, `${name}.png`);
}

// ── ПРОФИЛЬ ПРИЛОЖЕНИЯ: ТРИ ПАРАМЕТРА ───────────────────────────────────────
// Умолчания Примы. Каждый ПРОВЕРЯЕТ СЕБЯ и падает с внятным текстом: молчаливо
// сломавшееся умолчание — худший из исходов, потому что виноватым назначат
// следующее приложение, а не устаревший селектор.
export const ПРИМА = {
  async login(page) {
    const inputs = page.locator(".aocg-login-input");
    if ((await inputs.count()) === 0) return "уже был авторизован";
    const submit = page.locator(".aocg-login-submit");
    if ((await inputs.count()) < 2 || (await submit.count()) === 0)
      throw new Error(
        "вход по умолчанию (Прима) не сработал: экран входа есть, а полей " +
          `.aocg-login-input найдено ${await inputs.count()} и кнопок ` +
          `.aocg-login-submit ${await submit.count()}. Разметка входа изменилась — ` +
          "правьте умолчание ПРИМА.login, а не скрипт замера.",
      );
    const type = async (loc, value) => {
      await loc.click();
      await loc.fill("");
      await loc.pressSequentially(value, { delay: 15 });
    };
    await type(inputs.nth(0), process.env.AUDIT_EMAIL);
    await type(inputs.nth(1), process.env.AUDIT_PASSWORD);
    await submit.click();
    try {
      await page.waitForSelector(".aocg-login-input", {
        state: "detached",
        timeout: 20000,
      });
    } catch {
      const текст = await page.evaluate(() =>
        document.body.innerText.slice(0, 200),
      );
      throw new Error(
        `вход не прошёл. Страница говорит: ${текст.replace(/\n/g, " | ")}`,
      );
    }
    return "вошли";
  },

  // Переход по нижнему меню + ПОДТВЕРЖДЕНИЕ: в шапке появилось название
  // экрана. Без подтверждения промах по кнопке выглядит как «на экране нет
  // нужного элемента», и чинить начинают не то.
  async goto(page, экран) {
    await page.evaluate((name) => {
      const n = [...document.querySelectorAll("span,div,button")].find(
        (e) => e.textContent.trim() === name && e.children.length === 0,
      );
      if (n) (n.closest("button") || n).click();
    }, экран);
    await page.waitForTimeout(1500);
    const заголовок = await page.evaluate(() => {
      const h = [...document.querySelectorAll("div,span,h1,h2")].find((e) => {
        const cs = getComputedStyle(e);
        const r = e.getBoundingClientRect();
        return (
          r.top < 80 &&
          r.height > 14 &&
          parseFloat(cs.fontSize) >= 16 &&
          (e.textContent || "").trim().length > 2 &&
          e.children.length === 0
        );
      });
      return h ? h.textContent.trim() : "";
    });
    if (заголовок !== экран)
      throw new Error(
        `переход на «${экран}» не подтверждён: в шапке «${
          заголовок || "ничего не нашлось"
        }». ` +
          "Либо такого пункта в меню нет, либо разметка шапки изменилась. " +
          "Замер дальше не идёт: мерить не тот экран хуже, чем не мерить вовсе.",
      );
    return заголовок;
  },

  // По чему понять, что данные ПРИШЛИ: маркер на экране и ручка, ответы
  // которой считаем. Финансам — свой маркер и /api/finance/.
  gate: { маркер: "₽", апи: /\/api\/(receipts|reports)/ },
};

// ── ВОРОТА ДАННЫХ ───────────────────────────────────────────────────────────
// Пустой экран и пустые данные выглядят ОДИНАКОВО. 05.08.2026 на этом я объявил
// три отчёта пропавшими с прода: в базе лежали все три, просто список не
// загрузился. Вердикт разводит случаи, потому что действия у них разные.
// Отдельная ветка — «маркер есть, а ответов ноль»: так выглядит УСТАРЕВШИЙ
// шаблон ручки, и без этой ветки половина ворот молча слепнет.
export function dataVerdict({ apiRows, apiSeen, domHas }) {
  if (domHas && apiSeen > 0)
    return {
      ok: true,
      reason: `данные на экране, ответов по ручке ${apiSeen} (строк ${apiRows})`,
    };
  if (domHas && apiSeen === 0)
    return {
      ok: false,
      reason:
        "ВОРОТА СЛЕПЫ: маркер на экране есть, но НИ ОДИН ответ не совпал с шаблоном " +
        "ручки. Скорее всего шаблон устарел (переименовали эндпоинт) — половина " +
        "проверки не работает, а выглядит как успех.",
    };
  if (apiSeen === 0)
    return {
      ok: false,
      reason:
        "НИ МАРКЕРА, НИ ОТВЕТОВ: до экрана, похоже, не дошли вовсе — проверьте " +
        "переход и шаблон ручки, прежде чем винить данные.",
    };
  if (apiRows === 0)
    return {
      ok: false,
      reason:
        "ДАННЫХ НЕТ: API ответил, но вернул 0 строк. Экран пуст закономерно — " +
        "это про данные, права или фильтр, а не про вёрстку.",
    };
  return {
    ok: false,
    reason:
      `ДАННЫЕ ПРИШЛИ (${apiRows} строк), НО ЭКРАН ИХ НЕ ПОКАЗАЛ. Это про отрисовку: ` +
      "не дождались рендера, упёрлись в лимит запросов или экран отвалился " +
      "на ошибке. НЕ повод объявлять данные пропавшими.",
  };
}

// ── ВХОД И ОТКРЫТИЕ ЭКРАНА ──────────────────────────────────────────────────
export async function openApp({
  width = 375,
  height = 812,
  screen = null,
  needData = true,
  url = null,
  headless = true,
  login = ПРИМА.login,
  goto = ПРИМА.goto,
  gate = ПРИМА.gate,
} = {}) {
  loadEnv();
  const URL_BASE = (url || process.env.AUDIT_URL || "").replace(/\/$/, "");
  if (!URL_BASE) throw new Error("не задан AUDIT_URL (.env рядом с прогоном)");

  const browser = await chromium.launch({ headless });
  const ctx = await browser.newContext({ locale: "ru-RU" });
  const page = await ctx.newPage();

  // Считаем ответы и строки: без этого «экран пуст» неотличимо от «данных нет».
  let apiRows = 0;
  let apiSeen = 0;
  page.on("response", async (res) => {
    if (!gate.апи.test(res.url())) return;
    if (res.request().method() !== "GET") return;
    apiSeen++;
    try {
      const body = await res.json();
      if (Array.isArray(body)) apiRows += body.length;
    } catch {
      /* не JSON — не наше дело */
    }
  });

  await page.addInitScript(() => {
    try {
      localStorage.setItem("consent_given", "true");
    } catch {
      /* приватный режим */
    }
  });
  await page.setViewportSize({ width, height });
  await page.goto(URL_BASE, { waitUntil: "networkidle" });

  const состояниеВхода = await login(page);
  console.log(`ВХОД: ${состояниеВхода}`);

  const close = async () => {
    await browser.close();
  };

  if (screen) {
    try {
      const где = await goto(page, screen);
      console.log(`ЭКРАН: ${где}`);
    } catch (e) {
      await page.screenshot({ path: shotPath("переход-не-удался") });
      await close();
      throw e;
    }
  }

  if (needData) {
    const маркер = typeof needData === "string" ? needData : gate.маркер;
    let domHas = false;
    for (let i = 0; i < 12; i++) {
      domHas = await page.evaluate(
        (m) => document.body.innerText.includes(m),
        маркер,
      );
      if (domHas) break;
      await page.waitForTimeout(1000);
    }
    const v = dataVerdict({ apiRows, apiSeen, domHas });
    console.log(`ДАННЫЕ: ${v.reason}`);
    if (!v.ok) {
      await page.screenshot({ path: shotPath("нет-данных") });
      await close();
      throw new Error(v.reason);
    }
  }

  return { page, close, browser };
}

// Пустая страница для самопроверок модуля: прод для них не нужен и вреден —
// синтетика воспроизводима, а прод меняется под руками.
export async function openBlank({ html = "", width = 375, height = 667 } = {}) {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ locale: "ru-RU" })).newPage();
  await page.setViewportSize({ width, height });
  await page.setContent(html);
  return { page, close: () => browser.close(), browser };
}

// ── ВЫБОР ЭЛЕМЕНТА С ОЖИДАНИЕМ ──────────────────────────────────────────────
// найти:  { текст: RegExp — по СОБСТВЕННОМУ тексту, внутри: CSS-селектор,
//           тег: "div", индекс: n — ОСОЗНАННЫЙ выбор из нескольких }
// ожидаю: { тег, шрифт: "400 13px", текст: RegExp, минШирина, минВысота, виден }
let probeSeq = 0;
export async function pick(page, { что, найти = {}, ожидаю = {} }) {
  const id = `probe-${++probeSeq}`;
  const res = await page.evaluate(
    ({ id, найти, ожидаю, что }) => {
      const rx = (w) => (w ? new RegExp(w.source, w.flags) : null);
      const own = (el) => {
        let t = "";
        for (const n of el.childNodes) if (n.nodeType === 3) t += n.textContent;
        return t.trim();
      };
      const паспорт = (el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const cls = (el.className || "")
          .toString()
          .split(" ")
          .filter(Boolean)[0];
        return {
          тег: el.tagName.toLowerCase(),
          id: el.id || null,
          класс: cls || null,
          текст: (own(el) || el.innerText || "").trim().slice(0, 40),
          шрифт: `${cs.fontWeight} ${cs.fontSize}`,
          x: Math.round(r.left),
          right: Math.round(r.right),
          ширина: +r.width.toFixed(1),
          высота: +r.height.toFixed(1),
        };
      };

      const tag = найти.тег || "*";
      let cands = найти.внутри
        ? [...document.querySelectorAll(найти.внутри)].flatMap((s) => [
            ...s.querySelectorAll(tag),
          ])
        : [...document.querySelectorAll(tag)];
      const reText = rx(найти.текст);
      if (reText) cands = cands.filter((el) => reText.test(own(el)));
      // Поиск по aria-label: у иконочных кнопок собственного текста нет вовсе,
      // и «первая кнопка» вместо нужной — это ровно случай ② (померил соседа).
      if (найти.ария)
        cands = cands.filter(
          (el) => (el.getAttribute("aria-label") || "") === найти.ария,
        );
      cands = cands.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 || r.height > 0;
      });
      // ИНДЕКС ТРЕБУЕТ СИЛЬНОГО ОЖИДАНИЯ — правило куплено шестым случаем
      // (07.08.2026). Индекс отключает защиту «ровно один кандидат», то есть
      // разрешает молчаливый выбор. Со слабым ожиданием это ровно старая
      // ловушка, только с разрешения: `{тег:"button", индекс:0}` выбрал
      // переключатель приложений 38×38 вместо плавающей кнопки 56×56 —
      // паспорт промах показал, а pick пропустил. Поэтому: задал индекс —
      // назови не меньше ДВУХ признаков из тега, шрифта и текста.
      if (найти.индекс !== undefined) {
        const сильных = ["тег", "шрифт", "текст"].filter(
          (k) => ожидаю[k],
        ).length;
        if (сильных < 2)
          return {
            ошибка:
              `«${что}»: индекс задан ЯВНО, но ожидание слабое (признаков ${сильных} из нужных 2). ` +
              "Индекс снимает защиту «ровно один кандидат» — без сильного ожидания " +
              "промах пройдёт молча. Назовите тег, шрифт или текст.",
            кандидаты: cands.slice(0, 6).map(паспорт),
          };
        cands = cands.slice(найти.индекс, найти.индекс + 1);
      }

      if (cands.length === 0)
        return {
          ошибка: `не найдено ни одного кандидата для «${что}»`,
          кандидаты: [],
        };
      if (cands.length > 1)
        return {
          ошибка:
            `найдено ${cands.length} кандидатов для «${что}», ожидался ОДИН. ` +
            "Сузьте поиск (внутри/тег/текст) или укажите индекс ЯВНО — " +
            "молчаливый выбор первого это и есть «померил соседа».",
          кандидаты: cands.slice(0, 6).map(паспорт),
        };

      const el = cands[0];
      el.setAttribute("data-dbg", id);
      const p = паспорт(el);
      const беды = [];
      if (ожидаю.тег && p.тег !== ожидаю.тег)
        беды.push(`тег: ожидал ${ожидаю.тег}, элемент ${p.тег}`);
      if (ожидаю.шрифт && p.шрифт !== ожидаю.шрифт)
        беды.push(`шрифт: ожидал ${ожидаю.шрифт}, элемент ${p.шрифт}`);
      const reExp = rx(ожидаю.текст);
      if (reExp && !reExp.test(p.текст))
        беды.push(`текст: ожидал /${reExp.source}/, элемент «${p.текст}»`);
      if (ожидаю.минШирина && p.ширина < ожидаю.минШирина)
        беды.push(`ширина ${p.ширина} меньше ожидаемых ${ожидаю.минШирина}`);
      if (ожидаю.минВысота && p.высота < ожидаю.минВысота)
        беды.push(`высота ${p.высота} меньше ожидаемых ${ожидаю.минВысота}`);
      if (ожидаю.виден) {
        const r = el.getBoundingClientRect();
        if (
          r.right <= 0 ||
          r.left >= window.innerWidth ||
          r.bottom <= 0 ||
          r.top >= window.innerHeight
        )
          беды.push(
            `элемент вне экрана: x ${p.x}..${p.right}, y ${Math.round(r.top)}`,
          );
      }
      return { паспорт: p, беды };
    },
    {
      id,
      найти: { ...найти, текст: reWire(найти.текст) },
      ожидаю: { ...ожидаю, текст: reWire(ожидаю.текст) },
      что,
    },
  );

  if (res.ошибка) {
    if (res.кандидаты?.length) {
      console.log(`ПАСПОРТ ✖ «${что}» — кандидатов ${res.кандидаты.length}:`);
      res.кандидаты.forEach((p, i) => console.log(`   [${i}] ${фраза(p)}`));
    }
    throw new Error(res.ошибка);
  }

  // ПАСПОРТ ВСЕГДА, и при успехе тоже.
  console.log(`ПАСПОРТ «${что}»: ${фраза(res.паспорт)}`);
  if (res.беды.length) {
    res.беды.forEach((b) => console.log(`   ✖ ${b}`));
    throw new Error(
      `«${что}»: элемент не совпал с ожиданием — ${res.беды.join("; ")}`,
    );
  }
  return { page, sel: `[data-dbg="${id}"]`, паспорт: res.паспорт, что };
}

const фраза = (p) =>
  `${p.тег}${p.id ? "#" + p.id : ""}${p.класс ? "." + p.класс : ""} ` +
  `«${p.текст}» · ${p.шрифт} · x ${p.x}..${p.right} · ${p.ширина}×${p.высота}`;

// ── ЗАМЕР В МЕСТЕ ───────────────────────────────────────────────────────────
export async function measure(h) {
  return h.page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      ширина: +r.width.toFixed(1),
      нужно: el.scrollWidth,
      усечён: el.scrollWidth > el.clientWidth + 1,
      x: Math.round(r.left),
      right: Math.round(r.right),
      высота: +r.height.toFixed(1),
      шрифт: `${cs.fontWeight} ${cs.fontSize}`,
      многоточие: cs.textOverflow === "ellipsis",
    };
  }, h.sel);
}

// Ширина ЧУЖОГО текста в ЭТОМ элементе: подставляем в него самого, меряем,
// возвращаем как было — и ПРОВЕРЯЕМ, что вернули. Скрытая проба рядом брала
// шрифт документа и врала на 6px (случай ①).
export async function textWidth(h, текст) {
  const r = await h.page.evaluate(
    ({ sel, текст }) => {
      const el = document.querySelector(sel);
      const было = el.textContent;
      el.textContent = текст;
      const w = el.scrollWidth;
      el.textContent = было;
      return { ширина: w, вернулось: el.textContent === было };
    },
    { sel: h.sel, текст },
  );
  if (!r.вернулось)
    throw new Error(
      `textWidth не восстановил текст в «${h.что}» — элемент испорчен замером`,
    );
  return r.ширина;
}

// ── ТАП С ПРЕДУСЛОВИЯМИ ─────────────────────────────────────────────────────
// 06.08 скрипт кликал по отрицательному X в строке, открытой свайпом: тап
// уходил мимо, а выглядело как «жест не сбрасывается» (случай ③).
export async function tap(h) {
  const проверка = await h.page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const вне =
      r.right <= 0 ||
      r.left >= window.innerWidth ||
      r.bottom <= 0 ||
      r.top >= window.innerHeight;
    const под = вне ? null : document.elementFromPoint(x, y);
    return {
      вне,
      x: Math.round(x),
      y: Math.round(y),
      попал: !!(под && (под === el || el.contains(под))),
      подЭлемент: под
        ? под.tagName.toLowerCase() +
          (под.className ? "." + String(под.className).split(" ")[0] : "")
        : "ничего",
    };
  }, h.sel);
  if (проверка.вне)
    throw new Error(
      `тап по «${h.что}» отменён: элемент вне экрана (центр ${проверка.x},${проверка.y})`,
    );
  if (!проверка.попал)
    throw new Error(
      `тап по «${h.что}» отменён: в точке ${проверка.x},${проверка.y} лежит ${проверка.подЭлемент}, ` +
        "а не он. Клик ушёл бы мимо и выглядел как «не сработало».",
    );
  await h.page.locator(h.sel).click();
  return проверка;
}

// ── СКРИНШОТ ────────────────────────────────────────────────────────────────
export async function shot(page, имя, opts = {}) {
  const path = shotPath(имя);
  await page.screenshot({ path, ...opts });
  console.log(`СНИМОК: ${path}`);
  return path;
}
