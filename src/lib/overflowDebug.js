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

function scan() {
  const W = window.innerWidth;
  const out = [];
  const clip = [];
  document.querySelectorAll("*").forEach((el) => {
    if (el.dataset.ovfPanel) return; // сама панель не в счёт
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;

    // (1) вылез за экран → прокрутка документа
    const over = Math.round(r.right - W);
    if (over > 1) out.push({ el, over });

    // (2) содержимое шире собственной ширины → обрезано или скроллится внутри
    const hidden = Math.round(el.scrollWidth - el.clientWidth);
    if (hidden > 1) {
      const ov = getComputedStyle(el).overflowX;
      // auto/scroll — это НАМЕРЕННАЯ прокрутка (капсула фильтров), не дефект
      if (ov === "hidden" || ov === "clip") clip.push({ el, hidden });
    }
  });
  out.sort((a, b) => b.over - a.over);
  clip.sort((a, b) => b.hidden - a.hidden);
  return { out, clip };
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

export function initOverflowDebug() {
  if (typeof window === "undefined") return;
  if (!window.location.hash.includes(MARK)) return;

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
    const { out, clip } = scan();
    // Красным — то, что режется (его не видно на экране, это важнее);
    // жёлтым — то, что вылезло за вьюпорт.
    marked = [...clip.slice(0, 8), ...out.slice(0, 8)].map((f) => f.el);
    clip.slice(0, 8).forEach((f, i) => {
      f.el.style.outline = i === 0 ? "3px solid #FF3B30" : "2px dashed #FF9F0A";
      f.el.style.outlineOffset = "-2px";
    });
    out.slice(0, 8).forEach((f) => {
      f.el.style.outline = "2px dashed #FFD60A";
      f.el.style.outlineOffset = "-2px";
    });
    const doc = Math.round(document.documentElement.scrollWidth);
    const lines = [
      `экран ${window.innerWidth}  документ ${doc}  ` +
        `${doc > window.innerWidth ? "→ ЕСТЬ ПРОКРУТКА" : "прокрутки нет"}`,
      `ОБРЕЗАНО (содержимое не влезло, режет overflow:hidden): ${clip.length}`,
      ...clip
        .slice(0, 6)
        .map(
          (f, i) => `${i === 0 ? "▶" : " "} −${f.hidden}px  ${describe(f.el)}`,
        ),
      `ВЫЛЕЗЛО ЗА ЭКРАН: ${out.length}`,
      ...out
        .slice(0, 4)
        .map(
          (f, i) => `${i === 0 ? "▶" : " "} +${f.over}px  ${describe(f.el)}`,
        ),
    ];
    panel.textContent = lines.join("\n");
  }

  run();
  window.addEventListener("resize", run, { passive: true });
  // Пересчёт после каждого тапа: переполнение часто появляется от смены
  // состояния (жирная активная подпись, раскрытый фильтр), а не при загрузке.
  document.addEventListener("click", () => setTimeout(run, 120), true);
}
