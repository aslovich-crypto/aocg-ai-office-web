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

// ДОСТИЖИМ ЛИ ЭЛЕМЕНТ ПРОКРУТКОЙ. Внутри капсулы фильтров чипы намеренно
// лежат за краем — до них доезжают пальцем, и это не дефект. Но исключать
// ВСЁ содержимое горизонтальных скроллеров нельзя: сторож ослепнет ровно
// там, где живут чипы периодов и статусов. Поэтому граница проходит
// по scrollWidth: что внутри него — доступно прокруткой, что за ним —
// не достать никаким жестом, и это настоящий дефект.
function reachableByScroll(el, r) {
  let p = el.parentElement;
  while (p && p !== document.body && p !== document.documentElement) {
    const ox = getComputedStyle(p).overflowX;
    if (ox === "hidden" || ox === "clip") return false; // режет, а не листает
    if (ox === "auto" || ox === "scroll") {
      // ТОЛЬКО ЕСЛИ КОНТЕЙНЕР ДЕЙСТВИТЕЛЬНО ЛИСТАЕТСЯ ВБОК. У страницы стоит
      // overflow:auto ради ВЕРТИКАЛЬНОЙ прокрутки, и тогда overflowX тоже
      // «auto», хотя вбок там ничего не двигается. Без этой проверки любой
      // элемент, помещающийся по горизонтали, объявлялся «достижимым
      // прокруткой» и выпадал из отчёта — то есть группа «шире родителя»
      // ослепла целиком. Замер: дефекты Главной (+156px и +107px) лежали
      // в DOM, а список нарушений был пуст на ВСЕХ экранах и ширинах.
      // Не листается вбок — идём выше по цепочке, а не считаем достижимым.
      if (p.scrollWidth <= p.clientWidth + 1) {
        p = p.parentElement;
        continue;
      }
      const pr = p.getBoundingClientRect();
      // Левый край СОДЕРЖИМОГО скроллера во вьюпортных координатах:
      // видимая левая граница минус то, что уже прокручено.
      const contentLeft = pr.left + p.clientLeft - p.scrollLeft;
      // ВНИМАНИЕ: эта ветка НЕ ПОКРЫТА МУТАЦИЕЙ, и проверить её
      // синтетической пробой нельзя в принципе. Браузер расширяет
      // прокручиваемую область под ЛЮБОЙ вставленный элемент: кладёшь
      // пробу за край — край переезжает за ней, и она становится
      // достижимой в тот же миг. Замер это показал прямо:
      //     scrollWidth до вставки 411 → после 511, правый край пробы 511.
      // То есть «вышел за scrollWidth» для правого переполнения почти
      // недостижимо само по себе. Ветка оставлена ради реального случая,
      // который она покрывает: промежуточный контейнер с overflow:hidden
      // ВНУТРИ скроллера — тогда до содержимого действительно не добраться
      // (цикл выше вернёт false, встретив режущий контейнер).
      // Не считать эту строку проверенной наравне с остальными (T21).
      return r.right - contentLeft <= p.scrollWidth + 1;
    }
    p = p.parentElement;
  }
  return false;
}

// ВИДНО ЛИ ЭЛЕМЕНТ В ТОРЧАЩЕЙ ПОЛОСЕ. Библиотеки графиков (recharts и любые
// другие) держат свой внутренний размер в служебной обёртке, а рисуют
// в габарите родителя: обёртка «шире родителя» на сотни пикселей, а глазом
// всё в границах — подтверждено скриншотом Сводки @375.
//
// Проверяем не ИМЯ (класс отвалится молча при смене вёрстки библиотеки),
// а ФАКТ: ставим пробы точкой в полосе, на которую элемент якобы вылез,
// и спрашиваем, что там нарисовано. Вернулся сам элемент или его потомок —
// он там есть, дефект настоящий. Вернулось другое — числа существуют только
// в геометрии.
//
// Точек несколько: текст может попасть в промежуток между буквами, а у полосы
// бывает своя высота. Если торчащую часть режет предок, элемента в пробе тоже
// не окажется — но этот случай ловит отдельная группа «срезан предком»,
// дырки не возникает.
function paintedBeyond(el, r, edgeX) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  // ТОЛЬКО ТОЧКИ В КАДРЕ. elementFromPoint возвращает null за пределами видимой
  // области, и первая версия принимала это за «не нарисован» — то есть за
  // фантом. На деле так отсеивалось ВСЁ, что ниже сгиба на любом прокручиваемом
  // экране: дефект «Корпоративная 3950» на Главной вылезал на 107px и молча
  // пропадал из отчёта, потому что список последних чеков лежит за кадром.
  // Замер: три пробы из трёх вернули null при живом дефекте.
  const xs = [0.25, 0.5, 0.75]
    .map((k) => edgeX + (r.right - edgeX) * k)
    .filter((x) => x >= 0 && x < W);
  const ys = [0.5, 0.25, 0.75]
    .map((k) => r.top + r.height * k)
    .filter((y) => y >= 0 && y < H);
  // НЕ МОЖЕМ ИЗМЕРИТЬ — НЕ ИМЕЕМ ПРАВА ОБЪЯВЛЯТЬ ФАНТОМОМ. Бремя лежит
  // на пропуске, а не на срабатывании: лишняя строка в отчёте видна и
  // разбирается, а слепота не видна никак.
  if (!xs.length || !ys.length) return true;
  for (const x of xs)
    for (const y of ys) {
      const t = document.elementFromPoint(x, y);
      if (t && (t === el || el.contains(t))) return true;
    }
  return false;
}

function scan() {
  // Панель перекрывает верх экрана и попадала бы в пробы как «то, что
  // сверху». На время замера делаем её прозрачной для попаданий.
  const panelEl = document.querySelector("[data-ovf-panel]");
  const prevPE = panelEl ? panelEl.style.pointerEvents : null;
  if (panelEl) panelEl.style.pointerEvents = "none";
  try {
    return scanInner();
  } finally {
    if (panelEl) panelEl.style.pointerEvents = prevPE || "";
  }
}

function scanInner() {
  const W = window.innerWidth;
  const over = new Map(); // элемент → на сколько вылез
  const clip = [];
  document.querySelectorAll("*").forEach((el) => {
    if (el.dataset.ovfPanel) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;

    const out = Math.round(r.right - W);
    if (out > 1 && !reachableByScroll(el, r)) over.set(el, out);

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
    const edgeX = pr.right - padR;
    const diff = Math.round(r.right - edgeX);
    if (diff > 1 && !reachableByScroll(el, r) && paintedBeyond(el, r, edgeX))
      outgrow.push({ el, diff });
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
  const rejects = []; // почему кандидат НЕ попал в список — для #overflow-why
  document.querySelectorAll("*").forEach((el) => {
    if (el.dataset.ovfPanel) return;
    const r = el.getBoundingClientRect();
    const drop = (why, extra = "") =>
      rejects.push({ el, why, extra, right: r.right });

    if (r.width === 0 && r.height === 0) return;
    if (getComputedStyle(el).textOverflow === "ellipsis")
      return drop("многоточие");
    const clipper = nearestClipper(el);
    if (!clipper) return drop("нет режущего предка (или выше стоит скроллер)");

    // Дробные границы: 500.4 против 500.0 — реальное переполнение
    // в полпикселя. Округлять ДО сравнения нельзя, иначе тонкий обрез
    // исчезает. Округляем только для показа.
    const cut = r.right - contentRight(clipper);
    if (cut <= 0.5) return;

    // Показываем границу: если родитель срезан ТЕМ ЖЕ предком не слабее,
    // потомок беду унаследовал. Но если потомок торчит ДАЛЬШЕ родителя —
    // это его собственный дефект, и он обязан попасть в список: прошлая
    // версия отсекала такие случаи и теряла настоящего виновника.
    const par = el.parentElement;
    if (par && nearestClipper(par) === clipper) {
      const pcut = par.getBoundingClientRect().right - contentRight(clipper);
      if (pcut >= cut - 0.5)
        return drop("родитель срезан не меньше", `род −${Math.round(pcut)}px`);
    }
    cutoff.push({ el, cut: Math.round(cut), clipper });
  });
  cutoff.sort((a, b) => b.cut - a.cut);

  return { boundary, total: over.size, clip, outgrow, cutoff, rejects };
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
// Проба «торчит и виден»: элемент В КАДРЕ, который реально вылезает
// за родителя и нарисован там. Нужна, чтобы проверить не только молчание
// пробы, но и её ГОЛОС: без неё мы знаем лишь, что фантомы отсеиваются,
// и не знаем, что настоящее не отсеивается заодно.
function injectPaintProbe() {
  const host = [...document.querySelectorAll("div")].find((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return (
      r.top >= 0 &&
      r.bottom < window.innerHeight &&
      r.width > 120 &&
      r.height > 24 &&
      cs.overflowX === "visible"
    );
  });
  if (!host) return "видимый контейнер без обрезания не найден";
  const wrap = document.createElement("div");
  wrap.style.cssText = "width:40px;height:18px;position:relative;";
  const kid = document.createElement("span");
  kid.dataset.ovfProbe = "1";
  kid.textContent = "ТОРЧИТ-И-ВИДЕН";
  kid.style.cssText =
    "display:inline-block;width:200px;white-space:nowrap;background:#BF5AF2;" +
    "color:#fff;font:9px/18px sans-serif;";
  wrap.appendChild(kid);
  host.appendChild(wrap);
  return `проба «торчит и виден» в ${describe(host).slice(
    0,
    20,
  )} — ДОЛЖНА попасть в «шире родителя»`;
}

function injectProbe(extra) {
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
  probe.textContent = `ПРОБА T11 +${extra}px`;
  probe.style.cssText =
    `width:${Math.round(cand.getBoundingClientRect().width) + extra}px;` +
    "height:10px;background:#BF5AF2;color:#fff;font:700 8px/10px sans-serif;" +
    "flex-shrink:0;";
  cand.appendChild(probe);
  return `проба вставлена в ${describe(cand).slice(
    0,
    24,
  )} — она ДОЛЖНА попасть в «срезан предком»`;
}

// ── ПОЧЕМУ НЕ ПОЙМАЛ (#overflow-why) ────────────────────────────────────────
// Печатает то, что иначе пришлось бы смотреть в инспекторе: геометрию
// элемента и КАЖДОГО предка до #root — правую границу, правую границу
// содержимого, overflow. И список кандидатов, которых сторож отбросил,
// с причиной каждого. Нужен ровно тогда, когда глазами дефект видно,
// а группа показывает ноль: без этого спор «сторож врёт / вёрстка цела»
// решается рассуждением, а рассуждение сегодня трижды ошибалось.
function geometry(el) {
  const out = [];
  let n = el;
  for (let i = 0; i < 7 && n && n !== document.body; i++) {
    const r = n.getBoundingClientRect();
    const cs = getComputedStyle(n);
    out.push(
      `${describe(n).slice(0, 22)} right=${r.right.toFixed(1)} ` +
        `contR=${contentRight(n).toFixed(1)} ovf=${cs.overflowX}`,
    );
    n = n.parentElement;
  }
  return out;
}

// ── ПЕРЕКРЫТО ПЛАВАЮЩИМ (#overflow-hit) ─────────────────────────────────────
// Пятый вопрос: содержимое не обрезано и никуда не вылезло, но его НЕ ВИДНО,
// потому что сверху лежит плавающая кнопка. Геометрически это не переполнение,
// поэтому первые четыре группы честно молчат — и правильно делают.
//
// ПОЧЕМУ ЭТО НЕ ПОСТОЯННАЯ ПРОВЕРКА, А РЕЖИМ ПО ЗАПРОСУ: плавающая кнопка
// перекрывает содержимое ПО ЗАМЫСЛУ, это её работа. Автоматическая группа
// кричала бы на каждом экране с FAB и стала бы фоном. Здесь важен не сам
// факт перекрытия, а решение человека: приемлемо оно или нет.
//
// Фильтр от шума: учитываются только МЕЛКИЕ плавающие элементы — меньше
// четверти экрана. Полноэкранные оверлеи (модалки, шторки) перекрывают всё
// намеренно, они не дефект.
function overlapProbe() {
  // Собственная панель лежит поверх всего и попадала в elementFromPoint как
  // «то, что сверху» — сторож мерил сам себя. Из списка перекрытых мы её
  // исключали, а из ответа «кто сверху» нет. На время замера делаем её
  // прозрачной для попаданий и возвращаем как было.
  const panelEl = document.querySelector("[data-ovf-panel]");
  const prevPE = panelEl ? panelEl.style.pointerEvents : null;
  if (panelEl) panelEl.style.pointerEvents = "none";
  try {
    return overlapProbeInner();
  } finally {
    if (panelEl) panelEl.style.pointerEvents = prevPE || "";
  }
}

function overlapProbeInner() {
  const VW = window.innerWidth;
  const VH = window.innerHeight;
  const out = [];
  document.querySelectorAll("*").forEach((f) => {
    if (f.dataset.ovfPanel) return;
    const pos = getComputedStyle(f).position;
    if (pos !== "fixed" && pos !== "sticky") return;
    const fr = f.getBoundingClientRect();
    if (fr.width < 8 || fr.height < 8) return;
    if (fr.width * fr.height > VW * VH * 0.25) return; // оверлей, не кнопка
    // Что РЕАЛЬНО лежит сверху в центре плавающего элемента и слева от него
    const cx = fr.left + fr.width / 2;
    const cy = fr.top + fr.height / 2;
    const top = document.elementFromPoint(cx, cy);
    const covered = [];
    document.querySelectorAll("span,div,button").forEach((el) => {
      if (el === f || f.contains(el) || el.contains(f)) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (r.right <= fr.left || r.left >= fr.right) return;
      if (r.bottom <= fr.top || r.top >= fr.bottom) return;
      if (r.width > VW * 0.9) return; // страница целиком, не содержимое
      const hidden = Math.round(r.right - fr.left);
      if (hidden <= 1) return;

      // ПЕРЕКРЫТИЕ — ЭТО НЕ ПЕРЕСЕЧЕНИЕ ПРЯМОУГОЛЬНИКОВ. Прошлая версия
      // сравнивала только геометрию и не знала о слоях, поэтому на экране
      // деталей чека отчиталась, будто кнопка «+» накрывает сумму позиции,
      // хотя кнопка лежит ПОД оверлеем (у неё слой auto/40, у модалки 150)
      // и не видна вовсе. Сторож, который врёт на каждом экране с открытым
      // оверлеем, быстро становится фоном.
      // Проверяем фактом: что РЕАЛЬНО сверху в точках пересечения. Точек
      // три, а не одна: кнопка круглая, и центр пересечения может попасть
      // мимо неё — по углам круга элемент виден.
      const ix1 = Math.max(r.left, fr.left);
      const ix2 = Math.min(r.right, fr.right);
      const iy1 = Math.max(r.top, fr.top);
      const iy2 = Math.min(r.bottom, fr.bottom);
      const probes = [0.5, 0.25, 0.75].map((k) => [
        ix1 + (ix2 - ix1) * k,
        iy1 + (iy2 - iy1) * 0.5,
      ]);
      const reallyOnTop = probes.some(([px, py]) => {
        const t = document.elementFromPoint(px, py);
        return t && (t === f || f.contains(t));
      });
      if (!reallyOnTop) return;
      // С ТЕКСТОМ или ПУСТАЯ ОБОЛОЧКА. В прошлом замере из четырёх
      // перекрытых опасен был ровно один — сумма чека, остальное
      // контейнеры без собственного содержимого. Раз человек не видит
      // разницы в списке, её должен показывать сторож, иначе три строки
      // шума на одну находку.
      // Собственный текст = текст, которого нет ни в одном потомке-элементе:
      // так контейнер не выдаёт себя за носителя текста своих детей.
      let own = "";
      for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent;
      covered.push({ el, hidden, leaf: own.trim().length > 0 });
    });
    // Сначала носители текста: пустые оболочки человеку не видны в любом случае.
    covered.sort((a, b) => b.leaf - a.leaf || b.hidden - a.hidden);
    out.push({ f, fr, top, covered });
  });
  return out;
}

export function initOverflowDebug() {
  if (typeof window === "undefined") return;
  if (!window.location.hash.includes(MARK)) return;

  // Режим самопроверки: вставляем заведомо сломанный элемент и смотрим,
  // поймает ли его сторож. Вставка отложена — ждём, пока React отрисует.
  const H = window.location.hash;
  const THIN = H.includes("overflow-test-thin");
  const PAINT = H.includes("overflow-test-paint");
  const TEST = THIN || PAINT || H.includes("overflow-test");
  const WHY = H.includes("overflow-why");
  const HIT = H.includes("overflow-hit");
  let probeNote = "";

  // Структурный доступ для автоматического прогона (tools/layout-audit).
  // ЗАЧЕМ ИМЕННО ТАК: считывать показания из ТЕКСТА панели — значит разбирать
  // формулировки регулярками, и любая правка подписи ломает прогон молча.
  // Дублировать логику сканирования в скрипте нельзя тем более: копия
  // разойдётся с оригиналом при первой правке — та самая болезнь, с которой
  // мы боремся в теме, в документации и в вендорной копии ДС.
  // Отдаём ТЕ ЖЕ данные, что видит панель, только в виде значений.
  // Ставится ПОСЛЕ проверки метки выше: без #overflow в адресе этой функции
  // на window нет вовсе, как нет ни панели, ни слушателей.
  window.__overflowScan = () => {
    const { boundary, total, clip, outgrow, cutoff } = scan();
    const plain = (arr, key) =>
      arr.map((x) => ({ el: describe(x.el), px: x[key] }));
    return {
      screen: window.innerWidth,
      doc: Math.round(document.documentElement.scrollWidth),
      overflowTotal: total,
      boundary: plain(boundary, "over"),
      outgrow: plain(outgrow, "diff"),
      clip: plain(clip, "hidden"),
      cutoff: cutoff.map((x) => ({
        el: describe(x.el),
        px: x.cut,
        clipper: describe(x.clipper),
      })),
      overlap: overlapProbe().map((o) => ({
        floating: describe(o.f),
        rect: {
          x1: Math.round(o.fr.left),
          x2: Math.round(o.fr.right),
          y1: Math.round(o.fr.top),
          y2: Math.round(o.fr.bottom),
        },
        onTop: o.top ? describe(o.top) : null,
        covered: o.covered.map((c) => ({
          el: describe(c.el),
          px: c.hidden,
          leaf: c.leaf,
        })),
      })),
    };
  };

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
    const { boundary, total, clip, outgrow, cutoff, rejects } = scan();
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
    if (HIT) {
      const ov = overlapProbe();
      lines.push(`ПЛАВАЮЩИХ ЭЛЕМЕНТОВ (мельче четверти экрана): ${ov.length}`);
      for (const o of ov.slice(0, 2)) {
        const r = o.fr;
        lines.push(
          `   ${describe(o.f).slice(0, 20)} ` +
            `x=${Math.round(r.left)}..${Math.round(r.right)} ` +
            `y=${Math.round(r.top)}..${Math.round(r.bottom)}`,
        );
        lines.push(
          `   сверху в его центре: ${
            o.top ? describe(o.top).slice(0, 30) : "—"
          }`,
        );
        const withText = o.covered.filter((c) => c.leaf).length;
        lines.push(
          `   перекрывает: ${o.covered.length}, из них С ТЕКСТОМ ${withText}`,
        );
        lines.push(
          ...o.covered
            .slice(0, 3)
            .map(
              (c) =>
                `      −${c.hidden}px  ${c.leaf ? "ТЕКСТ" : "пусто"}  ` +
                `${describe(c.el).slice(0, 24)}`,
            ),
        );
      }
    }
    if (WHY) {
      const top = cutoff[0] || outgrow[0] || boundary[0];
      if (top) {
        lines.push("ГЕОМЕТРИЯ ЛУЧШЕГО КАНДИДАТА:");
        lines.push(...geometry(top.el).map((x) => "   " + x));
      }
      lines.push(`ОТБРОШЕНО КАНДИДАТОВ: ${rejects.length}`);
      lines.push(
        ...rejects
          .slice()
          .sort((a, b) => b.right - a.right)
          .slice(0, 6)
          .map(
            (x) =>
              `   ${describe(x.el).slice(0, 20)} right=${x.right.toFixed(1)}` +
              `  ✗ ${x.why}${x.extra ? " · " + x.extra : ""}`,
          ),
      );
    }
    if (TEST) {
      lines.unshift(
        "РЕЖИМ САМОПРОВЕРКИ (T11): " +
          (probeNote || "вставляю пробу…") +
          (PAINT
            ? "\nЕсли «шире родителя» = 0 — СТОРОЖ ОСЛЕП НА ВИДИМОЕ."
            : "\nЕсли «срезан предком» = 0 — СТОРОЖ НЕ РАБОТАЕТ."),
      );
    }
    panel.textContent = lines.join("\n");
  }

  run();
  if (TEST) {
    setTimeout(() => {
      probeNote = PAINT ? injectPaintProbe() : injectProbe(THIN ? 5 : 120);
      run();
    }, 800);
  }
  window.addEventListener("resize", run, { passive: true });
  // Пересчёт после каждого тапа: переполнение часто появляется от смены
  // состояния (жирная активная подпись, раскрытый фильтр), а не при загрузке.
  document.addEventListener("click", () => setTimeout(run, 120), true);
}
