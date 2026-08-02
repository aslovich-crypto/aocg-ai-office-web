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
// ГРАНИЦА: показывает элементы, чья ПРАВАЯ граница выходит за innerWidth.
// Элемент, который сам помещается, но растягивает родителя косвенно
// (например, из-за padding при content-box), тоже попадёт в список — потому
// что его собственная граница уедет. А вот элемент, спрятанный под
// overflow:hidden, виден не будет: он не создаёт прокрутку.

const MARK = "overflow";

function scan() {
  const W = window.innerWidth;
  const found = [];
  document.querySelectorAll("*").forEach((el) => {
    if (el.dataset.ovfPanel) return; // сама панель не в счёт
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    const over = Math.round(r.right - W);
    if (over > 1) found.push({ el, over, r });
  });
  found.sort((a, b) => b.over - a.over);
  return found;
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
    const found = scan();
    marked = found.slice(0, 12).map((f) => f.el);
    marked.forEach((el, i) => {
      el.style.outline = i === 0 ? "3px solid #FFD9DA" : "2px dashed #FDE68A";
      el.style.outlineOffset = "-2px";
    });
    const doc = Math.round(document.documentElement.scrollWidth);
    panel.textContent =
      `ШИРЕ ЭКРАНА: ${found.length}   экран ${window.innerWidth}   документ ${doc}\n` +
      (found.length
        ? found
            .slice(0, 8)
            .map(
              (f, i) =>
                `${i === 0 ? "▶" : " "} +${f.over}px  ${describe(f.el)}`,
            )
            .join("\n")
        : "переполнения нет — прокрутка вбок не отсюда");
  }

  run();
  window.addEventListener("resize", run, { passive: true });
  // Пересчёт после каждого тапа: переполнение часто появляется от смены
  // состояния (жирная активная подпись, раскрытый фильтр), а не при загрузке.
  document.addEventListener("click", () => setTimeout(run, 120), true);
}
