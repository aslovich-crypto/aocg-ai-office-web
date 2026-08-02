// Диагностика горизонтального переполнения — «кто шире экрана».
//
// ЗАЧЕМ. Когда страница уезжает вбок, виноват один элемент, который шире
// вьюпорта. Найти его без веб-инспектора нельзя, а инспектор на iPhone
// требует Mac, кабель и включённых «Дополнений» в Safari. Этот модуль
// показывает виновника прямо на экране телефона: обводит красным и печатает
// список сверху, чтобы хватило одного скриншота.
//
// КАК ВКЛЮЧИТЬ (работает и на проде, пересборка не нужна):
//     https://…/#overflow
// Выключить — убрать #overflow из адреса и перезагрузить.
//
// БЕЗОПАСНОСТЬ ДЛЯ ОБЫЧНЫХ ПОЛЬЗОВАТЕЛЕЙ: без метки в адресе модуль не делает
// НИЧЕГО — ни слушателей, ни обхода дерева. Поэтому его можно держать
// в проде: цена простоя нулевая, а польза появляется ровно тогда, когда
// нужна.
//
// ДВА РАЗНЫХ ДЕФЕКТА, И ЛОВЯТСЯ ОНИ ПО-РАЗНОМУ:
//
//   ПРОКРУТКА  — элемент вылез за вьюпорт, документ стал шире экрана,
//                каркас уезжает вбок. Признак: right > innerWidth.
//   ОБРЕЗАНИЕ  — элемент шире своего родителя, но родитель его режет
//                (overflow:hidden). Документ при этом РАВЕН экрану,
//                прокрутки нет, а содержимое просто не видно: карточка
//                срезана справа, пункт меню исчез.
//                Признак: scrollWidth > clientWidth У РОДИТЕЛЯ.
//
// Первая версия искала только прокрутку и на обрезании честно писала
// «переполнения нет» — при видимо срезанном экране. Отсюда вторая проверка:
// без неё детектор отвечает не на тот вопрос.

const MARK = "overflow";

// Ближайший предок, который РЕЖЕТ содержимое. overflow-x auto/scroll —
// не режет, а прокручивает: там содержимое доступно, это не дефект.
function nearestClipper(el) {
  let p = el.parentElement;
  while (p && p !== document.body && p !== document.documentElement) {
    const ox = getComputedStyle(p).overflowX;
    if (ox === "auto" || ox === "scroll") return null;
    if (ox === "hidden" || ox === "clip") return p;
    p = p.parentElement;
  }
  return null;
}

// Правая граница СОДЕРЖИМОГО элемента во вьюпортных координатах:
// clientLeft снимает рамку, clientWidth — ширина без рамки и полосы прокрутки.
function contentRight(el) {
  const r = el.getBoundingClientRect();
  return r.left + el.clientLeft + el.clientWidth;
}

function scan() {
  const W = window.innerWidth;
  const over = new Map(); // элемент → на сколько вылез
  const clip = [];
  document.querySelectorAll("*").forEach((el) => {
    if (el.dataset.ovfPanel) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;

    const out = Math.round(r.right - W);
    if (out > 1) over.set(el, out);

    // Содержимое шире собственной ширины. Многоточие — НАМЕРЕННОЕ усечение
    // (подпись способа оплаты в строке чека), это не дефект вёрстки.
    const hidden = Math.round(el.scrollWidth - el.clientWidth);
    if (hidden > 1) {
      const cs = getComputedStyle(el);
      if (cs.textOverflow === "ellipsis") return;
      if (cs.overflowX === "hidden" || cs.overflowX === "clip")
        clip.push({ el, hidden });
    }
  });

  // ГРАНИЦА ПЕРЕПОЛНЕНИЯ. Когда предок стал шире экрана, за ним вылезают все
  // его потомки — на скриншоте это десятки строк, и настоящий виновник тонет
  // среди них. Виновник ровно один: элемент, который вылез, а его РОДИТЕЛЬ
  // нет. Его и показываем первым.
  const boundary = [...over.entries()]
    .filter(([el]) => !over.has(el.parentElement))
    .map(([el, o]) => ({ el, over: o }))
    .sort((a, b) => b.over - a.over);

  // ШИРЕ РОДИТЕЛЯ — слепая зона первой версии: элемент помещается в экран,
  // но торчит из своего контейнера, и его режет чужой overflow. Именно так
  // выглядели обрезанные плитки «Главной» при нулевых прочих счётчиках.
  const outgrow = [];
  document.querySelectorAll("*").forEach((el) => {
    if (el.dataset.ovfPanel || !el.parentElement) return;
    const p = el.parentElement;
    if (p === document.body || p === document.documentElement) return;
    const r = el.getBoundingClientRect();
    const pr = p.getBoundingClientRect();
    if (r.width === 0) return;
    const cs = getComputedStyle(p);
    const padR = parseFloat(cs.paddingRight) || 0;
    const diff = Math.round(r.right - (pr.right - padR));
    if (diff > 1) outgrow.push({ el, diff });
  });
  outgrow.sort((a, b) => b.diff - a.diff);

  // СРЕЗАН ПРЕДКОМ — четвёртая группа. Прошлые три отвечали на вопросы
  // «вылез за экран?», «сам себя режет?», «торчит из родителя?». Случай
  // «правая колонка выехала из карточки, а режет её обёртка свайпа через
  // два уровня» не покрывался ни одним: пострадавший не режет себя сам,
  // из своего родителя не торчит (они выехали вместе) и до края экрана
  // не дошёл — предок обрезал раньше. Дефект видно глазами и не видно
  // ни одной проверкой.
  const cutoff = [];
  document.querySelectorAll("*").forEach((el) => {
    if (el.dataset.ovfPanel) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    // Многоточие — намеренное усечение, не дефект.
    if (getComputedStyle(el).textOverflow === "ellipsis") return;
    const clipper = nearestClipper(el);
    if (!clipper) return;
    const cut = Math.round(r.right - contentRight(clipper));
    if (cut <= 1) return;
    // Показываем только ГРАНИЦУ: если родитель срезан тем же предком,
    // элемент лишь унаследовал беду — иначе список утонет в потомках,
    // как это было с 79 строками на «Чеках».
    const par = el.parentElement;
    if (par && nearestClipper(par) === clipper) {
      const pcut = Math.round(
        par.getBoundingClientRect().right - contentRight(clipper),
      );
      if (pcut > 1) return;
    }
    cutoff.push({ el, cut, clipper });
  });
  cutoff.sort((a, b) => b.cut - a.cut);

  return { boundary, total: over.size, clip, outgrow, cutoff };
}

// Цепочка предков с ширинами — по ней сразу видно, на каком уровне ширина
// вдруг стала больше, и что этот уровень добавил (padding при content-box
// прибавляется к width, см. T13).
function chain(el) {
  const out = [];
  let n = el;
  for (let i = 0; i < 5 && n && n !== document.body; i++) {
    const cs = getComputedStyle(n);
    const r = n.getBoundingClientRect();
    out.push(
      `${describe(n).slice(0, 26)} w=${Math.round(r.width)} ` +
        `pad=${parseFloat(cs.paddingLeft) || 0}/${
          parseFloat(cs.paddingRight) || 0
        } ` +
        `box=${cs.boxSizing === "border-box" ? "bb" : "CB"}`,
    );
    n = n.parentElement;
  }
  return out;
}

function describe(el) {
  const id = el.id ? `#${el.id}` : "";
  const cls =
    typeof el.className === "string" && el.className
      ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
      : "";
  const txt = (el.textContent || "").trim().slice(0, 18);
  return `${el.tagName.toLowerCase()}${id}${cls}${txt ? ` «${txt}»` : ""}`;
}

// ── МУТАЦИЯ НА УСТРОЙСТВЕ (правило T11) ─────────────────────────────────────
// Сторож, не проверенный мутацией, считается неработающим. Этот измеряет
// раскладку, а раскладки нет ни в Node, ни в jsdom — значит и мутация
// возможна только в настоящем браузере. Метка #overflow-test вставляет
// заведомо широкую полосу внутрь первого режущего контейнера на странице:
// панель ОБЯЗАНА показать её в группе «срезан предком». Не показала —
// дыра подтверждена замером, а не рассуждением.
function injectProbe() {
  const cand = [...document.querySelectorAll("div")].find((el) => {
    if (el.dataset.ovfPanel) return false;
    const ox = getComputedStyle(el).overflowX;
    if (ox !== "hidden" && ox !== "clip") return false;
    const r = el.getBoundingClientRect();
    return r.width > 160 && r.height > 40;
  });
  if (!cand)
    return "контейнер с overflow:hidden не найден — пробу вставить некуда";
  const probe = document.createElement("div");
  probe.dataset.ovfProbe = "1";
  probe.textContent = "ПРОБА T11";
  probe.style.cssText =
    `width:${Math.round(cand.getBoundingClientRect().width) + 120}px;` +
    "height:10px;background:#BF5AF2;color:#fff;font:700 8px/10px sans-serif;" +
    "flex-shrink:0;";
  cand.appendChild(probe);
  return `проба вставлена в ${describe(cand).slice(
    0,
    24,
  )} — она ДОЛЖНА попасть в «срезан предком»`;
}

export function initOverflowDebug() {
  if (typeof window === "undefined") return;
  if (!window.location.hash.includes(MARK)) return;

  // Режим самопроверки: вставляем заведомо сломанный элемент и смотрим,
  // поймает ли его сторож. Вставка отложена — ждём, пока React отрисует.
  const TEST = window.location.hash.includes("overflow-test");
  let probeNote = "";

  const panel = document.createElement("div");
  panel.dataset.ovfPanel = "1";
  panel.style.cssText = [
    "position:fixed",
    "left:0",
    "right:0",
    "top:0",
    "z-index:99999",
    "background:rgba(185,28,28,0.95)",
    "color:#fff",
    "font:600 11px/1.35 -apple-system,system-ui,sans-serif",
    "padding:8px 10px calc(8px + env(safe-area-inset-top))",
    "padding-top:calc(8px + env(safe-area-inset-top))",
    "max-height:45dvh",
    "overflow:auto",
    "white-space:pre-wrap",
  ].join(";");
  document.body.appendChild(panel);

  let marked = [];
  function run() {
    marked.forEach((el) => (el.style.outline = ""));
    const { boundary, total, clip, outgrow, cutoff } = scan();
    marked = [
      ...boundary.slice(0, 3).map((f) => f.el),
      ...clip.slice(0, 3).map((f) => f.el),
      ...outgrow.slice(0, 3).map((f) => f.el),
      ...cutoff.slice(0, 3).map((f) => f.el),
    ];
    boundary.slice(0, 3).forEach((f, i) => {
      f.el.style.outline = i === 0 ? "3px solid #FF3B30" : "2px dashed #FF9F0A";
      f.el.style.outlineOffset = "-2px";
    });
    outgrow.slice(0, 3).forEach((f) => {
      f.el.style.outline = "2px dashed #30D158";
      f.el.style.outlineOffset = "-2px";
    });
    clip.slice(0, 3).forEach((f) => {
      f.el.style.outline = "2px dotted #FFD60A";
    });
    cutoff.slice(0, 3).forEach((f, i) => {
      f.el.style.outline = i === 0 ? "3px solid #BF5AF2" : "2px dashed #BF5AF2";
      f.el.style.outlineOffset = "-2px";
    });

    const doc = Math.round(document.documentElement.scrollWidth);
    const lines = [
      `экран ${window.innerWidth}  документ ${doc}  ` +
        `${
          doc > window.innerWidth
            ? `ПРОКРУТКА +${doc - window.innerWidth}`
            : "прокрутки нет"
        }`,
      `ВЫЛЕЗЛИ ЗА ЭКРАН: ${total}, из них ПЕРВОПРИЧИН ${boundary.length}`,
      ...boundary
        .slice(0, 3)
        .map(
          (f, i) => `${i === 0 ? "▶" : " "} +${f.over}px  ${describe(f.el)}`,
        ),
    ];
    if (boundary.length) {
      lines.push("ЦЕПОЧКА ПЕРВОПРИЧИНЫ (CB = content-box, T13):");
      lines.push(...chain(boundary[0].el).map((x) => "   " + x));
    }
    lines.push(`ШИРЕ СВОЕГО РОДИТЕЛЯ: ${outgrow.length}`);
    lines.push(
      ...outgrow
        .slice(0, 3)
        .map(
          (f, i) => `${i === 0 ? "▶" : " "} +${f.diff}px  ${describe(f.el)}`,
        ),
    );
    lines.push(`СРЕЗАН ПРЕДКОМ: ${cutoff.length}`);
    lines.push(
      ...cutoff
        .slice(0, 3)
        .map(
          (f, i) =>
            `${i === 0 ? "▶" : " "} −${f.cut}px  ${describe(f.el)}` +
            `  ← режет ${describe(f.clipper).slice(0, 22)}`,
        ),
    );
    lines.push(`ОБРЕЗАНО без многоточия: ${clip.length}`);
    lines.push(
      ...clip.slice(0, 2).map((f) => `  −${f.hidden}px  ${describe(f.el)}`),
    );
    if (TEST) {
      lines.unshift(
        "РЕЖИМ САМОПРОВЕРКИ (T11): " +
          (probeNote || "вставляю пробу…") +
          "\nЕсли «срезан предком» = 0 — СТОРОЖ НЕ РАБОТАЕТ.",
      );
    }
    panel.textContent = lines.join("\n");
  }

  run();
  if (TEST) {
    setTimeout(() => {
      probeNote = injectProbe();
      run();
    }, 800);
  }
  window.addEventListener("resize", run, { passive: true });
  // Пересчёт после каждого тапа: переполнение часто появляется от смены
  // состояния (жирная активная подпись, раскрытый фильтр), а не при загрузке.
  document.addEventListener("click", () => setTimeout(run, 120), true);
}
