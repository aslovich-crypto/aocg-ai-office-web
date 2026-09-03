import { useState, useEffect, useRef } from "react";

import { useFabHidden, fabHiddenStyle } from "../hooks/useFabHidden";
import { ClipboardList, Plus, Search, Trash2, Undo2 } from "lucide-react";

import { C, FONT, theme } from "../lib/theme";
import { shortOrg, fmtDate, money } from "../lib/format";
import { catName } from "../lib/categories";
import { BADGE, isEditable, canApprove } from "../lib/reports";
import { РЕЖИМЫ_ПЕРИОДА, вПериоде } from "../lib/period";
import ReportDetailModal from "../components/ReportDetailModal";
import SwipeRow from "../components/SwipeRow";

// Экран «Отчёты» — вёрстка по макету templates/reports/Отчёты.html (ЧП2, INT).
// Логика (статусы, PATCH, создание) — из кода, вёрстка — из макета.
// Зависимости монолита (authFetch, Btn, Modal, RuleInput, Block)
// приходят пропсами из App.jsx — как у GlavnayaPage.

// Чипы фильтра: подпись «Проверка» — короткая (как в макете), в данных
// статус хранится полным значением «На проверке». value=null — «Все».
// Порядок как в макете: «Все» ПОСЛЕДНИЙ и активен по умолчанию
// (templates/reports/Отчёты.html — там же он и прокручен в кадр на загрузке).
// Значение null = «Все», начальное состояние statusFilter от порядка
// не зависит. Капсула прокручиваемая: при 320 всем пяти чипам нужен 411px
// при 254 видимых, поэтому два крайних всегда за краем — какие именно,
// решает как раз порядок.
const STATUS_CHIPS = [
  { chip: "Черновик", value: "Черновик" },
  { chip: "Проверка", value: "На проверке" },
  { chip: "Одобрен", value: "Одобрен" },
  { chip: "Отклонён", value: "Отклонён" },
  { chip: "Все", value: null },
];

export default function OtchetyPage({
  // Отмена удаления живёт в ОБОЛОЧКЕ (App.jsx), а не здесь: тост и таймер
  // обязаны пережить переход между вкладками нижнего меню, а этот экран
  // при переходе размонтируется.
  scheduleUndo,
  scrollRef,
  receipts,
  users, // для фильтра по автору: сопоставляем имя из фильтра с user_id отчёта
  FiltersModal, // общий компонент фильтров из App.jsx — второй копии не заводим
  FilterIcon,
  userId,
  role, // ЧП5б: гейт «Одобрить/Отклонить» в деталях отчёта
  authFetch,
  reloadReceipts, // после удаления отчёта его чеки освободились
  plural,
  Btn,
  Modal,
  RuleInput,
  Block,
  Toast,
}) {
  const [statusFilter, setStatusFilter] = useState(null); // null = «Все»
  const [reports, setReports] = useState([]);
  const [search, setSearch] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [showC, setShowC] = useState(false);
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState([]);
  // T148 ①: выбор периода в шторке создания. Отмечать месячную пачку по
  // одному чеку — «не работа, а мучение» (владелец); период прячет чужие
  // месяцы, «Выбрать все» берёт видимое одним нажатием.
  const [период, setПериод] = useState("все");
  // Открытый отчёт (детали). Одобрение/отклонение живёт ТОЛЬКО там —
  // чтобы решение принимали, увидев состав, а не вслепую из списка.
  const [openRep, setOpenRep] = useState(null);
  // Фильтры: период по created, автор и диапазон суммы. Статус НЕ дублируем —
  // он в капсуле чипов сверху (решение 05.08). Значения храним здесь, а не
  // в адресе: экран не имеет своего маршрута.
  const [showFilters, setShowFilters] = useState(false);
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [fEmp, setFEmp] = useState(null); // имя сотрудника, как его отдаёт фильтр
  const [fAmtFrom, setFAmtFrom] = useState("");
  const [fAmtTo, setFAmtTo] = useState("");
  const fabHidden = useFabHidden(scrollRef);
  const [toast, setToast] = useState(null); // {type,message,duration}
  // POST /reports in flight — blocks double-submit. Удаления отчётов пока нет
  // (REP-CRUD), поэтому дубль от двойного тапа убрать было бы нечем.
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.duration || 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Запасные тексты, когда показать нечего: detail отсутствует, пустой или
  // не предназначен пользователю.
  const FALLBACK_ANY = "Не удалось сохранить, попробуйте ещё раз";
  const FALLBACK_BY_STATUS = {
    // S-27: лимит по IP ≠ отказ операции, поэтому текст про «подождите».
    429: "Слишком много запросов, подождите минуту",
    // Отчёт мог быть удалён в другой вкладке — или он чужой (REP-ACL отдаёт
    // 404, чтобы чужой был неотличим от несуществующего).
    404: "Отчёт не найден",
  };

  // Человеческий текст ошибки. Бэк отчётов отдаёт {detail: "…"} — готовые
  // русские фразы, объясняющие СЛЕДУЮЩИЙ ШАГ («Отчёт на проверке — сначала
  // отзовите его», «Чек уже в другом отчёте», «Одобрять … может только
  // бухгалтер или администратор»). Их и показываем.
  // Но detail не всегда строка, поэтому берём его только если это строка:
  //   • 404 в reports.py — технический английский "Not found" → свой текст;
  //   • 422 (валидация FastAPI) — detail это СПИСОК объектов;
  //   • в соседних роутерах (receipts, categories) detail бывает объектом
  //     {error, message, existing_id}.
  // Иначе в тост уехало бы "[object Object]" или "Not found".
  async function errorMessage(res) {
    if (!res) return FALLBACK_ANY; // сетевой сбой / таймаут — ответа нет
    if (res.status === 404) return FALLBACK_BY_STATUS[404];
    let detail;
    try {
      const body = await res.json();
      detail = body && body.detail;
    } catch {
      // тело пустое (204) или не JSON — это не ошибка чтения, detail
      // остаётся undefined и ниже сработает фолбэк по статусу
    }
    if (typeof detail === "string" && detail.trim()) return detail;
    if (
      detail &&
      typeof detail === "object" &&
      !Array.isArray(detail) &&
      typeof detail.message === "string"
    ) {
      return detail.message;
    }
    return FALLBACK_BY_STATUS[res.status] || FALLBACK_ANY;
  }

  // Единая точка показа ошибки: принимает ОТВЕТ (не статус), чтобы прочитать
  // detail. Вызывать из любой ручки — changeStatus, create и будущих
  // delete/attach; повторять разбор в каждой не нужно.
  async function failToast(res) {
    setToast({
      type: "error",
      message: await errorMessage(res),
      duration: 4000,
    });
  }

  // Загрузка списка отдельной функцией: состав отчётов меняется и снаружи
  // экрана (прикрепление из карточки чека, работа в другой вкладке), поэтому
  // одного вызова на монтировании мало — перечитываем перед выбором чеков.
  async function loadReports() {
    try {
      const r = await authFetch(`/api/reports/`);
      // res.ok обязателен: при 429/500 тело — {detail: …}, не список.
      if (!r.ok) {
        await failToast(r);
        return;
      }
      const data = await r.json();
      if (Array.isArray(data)) setReports(data);
    } catch {
      failToast();
    }
  }

  // Загрузка на монтировании. Вызов отложен через queueMicrotask, чтобы
  // setState внутри loadReports не случился синхронно в теле эффекта —
  // это вызывает каскадный рендер (react-hooks/set-state-in-effect).
  // Отменять нечего: setReports защищён проверками внутри loadReports.
  useEffect(() => {
    queueMicrotask(loadReports);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Чек можно положить в отчёт, только если он ТОЧНО принадлежит текущему
  // пользователю. Условие самодостаточное: три проверки в одном предикате,
  // ни одна не переложена на UI или на порядок загрузки —
  //   • userId ещё не пришёл (первые кадры до /api/users/me) → выбирать
  //     нечего; без этой проверки сравнение null === null пропустило бы
  //     ровно легаси-чеки без владельца;
  //   • r.user_id пуст → легаси-чек «ничей», бэк его отвергнет
  //     («У чека нет владельца — его нельзя включить в отчёт»);
  //   • r.user_id чужой → 409 «Чек другого сотрудника» (инвариант АО-1:
  //     один отчёт = один подотчётный). Бухгалтер видит чеки всей орг,
  //     поэтому без фильтра он выбирал бы заведомо непроходной чек.
  const isMine = (r) =>
    userId != null && r.user_id != null && r.user_id === userId;
  const myReceipts = receipts.filter(isMine);
  const usedIds = reports.flatMap((r) => r.receiptIds || []);
  const free = myReceipts.filter((r) => !usedIds.includes(r.id));

  async function create() {
    if (isSubmitting) return; // защита от двойного клика
    setIsSubmitting(true);
    try {
      const res = await authFetch(`/api/reports/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // total не шлём: бэк считает его из состава (REP-CRUD ЧП1)
        body: JSON.stringify({ title, receiptIds: selected }),
      });
      // При ошибке модалку НЕ закрываем и форму НЕ чистим — введённое цело.
      if (!res.ok) {
        await failToast(res);
        return;
      }
      const created = await res.json();
      if (!created || typeof created.id !== "number") {
        failToast();
        return;
      }
      setReports((prev) => [...prev, created]);
      setTitle("");
      setSelected([]);
      setShowC(false);
    } catch {
      failToast();
    } finally {
      setIsSubmitting(false);
    }
  }

  async function changeStatus(id, status) {
    try {
      const res = await authFetch(`/api/reports/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      // Без этой проверки объект-ошибка {detail: …} подменял отчёт в списке:
      // карточка без названия, «0 чеков», сумма NaN — а сам отчёт исчезал.
      if (!res.ok) {
        await failToast(res);
        return;
      }
      const updated = await res.json();
      if (!updated || typeof updated.id !== "number") {
        failToast();
        return;
      }
      setReports((prev) => prev.map((r) => (r.id === id ? updated : r)));
      return updated; // деталям нужен свежий отчёт: они остаются открытыми
    } catch {
      failToast();
    }
  }

  // Открытие формы создания: перед выбором чеков перечитываем отчёты, иначе
  // usedIds протух и «свободный» чек окажется занятым (409 при сохранении).
  function openCreate() {
    loadReports();
    setShowC(true);
  }

  // Удалить отчёт. ВНИМАНИЕ: DELETE /api/reports/{id} отвечает 204 БЕЗ ТЕЛА —
  // res.json() здесь бросил бы SyntaxError, и удалённый на сервере отчёт
  // выглядел бы как ошибка. (Соседний DELETE /{id}/receipts/{rid} наоборот
  // возвращает 200 С ТЕЛОМ — обновлённый отчёт; не перепутать.)
  // Сами чеки не удаляются: уходит только связь (ON DELETE CASCADE на
  // report_items.report_id), чеки возвращаются в свободный пул.
  async function deleteReportNow(rep) {
    try {
      const res = await authFetch(`/api/reports/${rep.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        // 409 замороженного статуса придёт с готовым текстом бэка.
        // Строку возвращаем на место: она была убрана заранее, «оптимистично».
        await failToast(res);
        setReports((prev) =>
          prev.some((r) => r.id === rep.id) ? prev : [rep, ...prev],
        );
        return;
      }
      // Чеки отчёта освободились: у них сменился in_report/report_title,
      // иначе карточка чека продолжила бы показывать пометку «В отчёте».
      if (reloadReceipts) reloadReceipts();
    } catch {
      failToast();
      setReports((prev) =>
        prev.some((r) => r.id === rep.id) ? prev : [rep, ...prev],
      );
    }
  }

  // Удаление свайпом: строка исчезает сразу, запрос уходит отложенно, пока
  // висит тост с «Отменить». Подтверждения нет намеренно — смахнуть и тапнуть
  // это уже два осознанных действия, а страховкой служит отмена (решение
  // 05.08). Таймер и тост живут в ОБОЛОЧКЕ, поэтому переживают переход между
  // вкладками нижнего меню; при закрытии страницы таймер умирает вместе с ней
  // и отчёт остаётся — это принято осознанно, см. комментарий у scheduleUndo.
  function removeWithUndo(rep) {
    setReports((prev) => prev.filter((r) => r.id !== rep.id));
    setOpenRep((prev) => (prev && prev.id === rep.id ? null : prev));
    scheduleUndo?.({
      message: `Отчёт «${rep.title}» удалён`,
      commit: () => deleteReportNow(rep),
      cancel: () =>
        setReports((prev) =>
          prev.some((r) => r.id === rep.id) ? prev : [rep, ...prev],
        ),
    });
  }

  // ── ФИЛЬТРЫ ────────────────────────────────────────────────────────────────
  // Считаем на фронте: GET /api/reports/ параметров не принимает и отдаёт
  // список целиком (с составом), а отчётов пока единицы. Когда их станет
  // много, узким местом будет сама загрузка списка, а не этот filter.
  const empId = (name) => {
    if (!name || !Array.isArray(users)) return null;
    const u = users.find(
      (x) =>
        `${x.first_name || ""} ${x.last_name || ""}`.trim() === name ||
        x.email === name,
    );
    return u ? u.id : null;
  };
  const fEmpId = empId(fEmp);

  // «Фамилия И.» — формат из макета. Список сотрудников уже приходит пропом
  // (он нужен фильтру). Нет фамилии — берём имя, нет и его — ничего
  // не показываем: пустая метка хуже отсутствующей.
  const authorName = (uid) => {
    if (uid == null || !Array.isArray(users)) return "";
    const u = users.find((x) => x.id === uid);
    if (!u) return "";
    const last = (u.last_name || "").trim();
    const first = (u.first_name || "").trim();
    if (last) return first ? `${last} ${first[0]}.` : last;
    return first || "";
  };
  const inRange = (rep) => {
    // Период — по created: других дат у отчёта нет, месяц в названии это текст.
    const d = (rep.created || "").slice(0, 10);
    if (fFrom && d && d < fFrom) return false;
    if (fTo && d && d > fTo) return false;
    if (fEmp && fEmpId != null && rep.user_id !== fEmpId) return false;
    const total = Number(rep.total || 0);
    if (fAmtFrom !== "" && total < Number(fAmtFrom)) return false;
    if (fAmtTo !== "" && total > Number(fAmtTo)) return false;
    return true;
  };
  const filtersActive =
    !!fFrom || !!fTo || !!fEmp || fAmtFrom !== "" || fAmtTo !== "";

  // АКТИВНЫЙ ЧИП ДЕРЖИМ В КАДРЕ — приведение к макету
  // (templates/reports/Отчёты.html: «keep the active chip («Все», far right)
  // in view on load», rail.scrollLeft = active.offsetLeft + active.offsetWidth
  // − rail.clientWidth + 4). У нас этой строки не было ни одной, а капсуле
  // при 320 нужен 411px на 254 видимых — два чипа всегда за краем.
  // Последствие: активен «Все» (он последний), человек возвращается на экран,
  // видит слева «Черновик» без подсветки и решает, что фильтр сброшен.
  //
  // Отличие от макета намеренное: прокручиваем ТОЛЬКО если чип не виден
  // целиком. Макет крутит безусловно при загрузке, из-за чего капсула
  // дёргается даже когда всё и так в кадре.
  const segRef = useRef(null);
  useEffect(() => {
    const rail = segRef.current;
    if (!rail) return;
    const active = rail.querySelector('[aria-pressed="true"]');
    if (!active) return;
    const r = rail.getBoundingClientRect();
    const a = active.getBoundingClientRect();
    if (a.left >= r.left - 0.5 && a.right <= r.right + 0.5) return; // уже виден
    rail.scrollLeft =
      a.left < r.left
        ? active.offsetLeft - 4
        : active.offsetLeft + active.offsetWidth - rail.clientWidth + 4;
  }, [statusFilter]);

  const filtered = reports
    .filter(
      (r) =>
        (!statusFilter || r.status === statusFilter) &&
        (!search || r.title.toLowerCase().includes(search.toLowerCase())),
    )
    .filter(inRange);

  return (
    <div>
      <Toast toast={toast} />
      {/* Скрыть скроллбар капсулы в WebKit (инлайн-стили не умеют псевдоэлементы) */}
      <style>{`.otch-seg::-webkit-scrollbar{display:none}`}</style>

      {/* Полоса фильтров — тот же паттерн, что на Чеках (OperaciiPage):
          БЕЛАЯ подложка с границей снизу, серый фон контента идёт под ней.
          Токены/отступы скопированы оттуда 1:1. */}
      <div
        style={{
          background: theme.surface,
          borderBottom: `1px solid ${theme.border}`,
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            ref={segRef}
            className="otch-seg"
            style={{
              display: "flex",
              background: "#E6E9EF",
              borderRadius: 8,
              padding: 2,
              gap: 2,
              overflowX: "auto",
              scrollbarWidth: "none",
              msOverflowStyle: "none",
              WebkitOverflowScrolling: "touch",
            }}
          >
            {STATUS_CHIPS.map(({ chip, value }) => {
              const on = statusFilter === value;
              return (
                <button
                  key={chip}
                  type="button"
                  onClick={() => setStatusFilter(value)}
                  aria-pressed={on}
                  style={{
                    flex: "0 0 auto",
                    padding: "7px 12px",
                    border: on ? "1px solid #EEF0F4" : "1px solid transparent",
                    borderRadius: 6,
                    // 11px, как на «Чеках» и «Сводке». Канон макета — 13px,
                    // и на «Отчётах» они помещались (чипы по содержимому,
                    // капсула прокручивается), но тогда шрифт полосы
                    // отличался бы от двух других экранов, где 13px
                    // не влезают: при 320 капсула даёт 38-45px на чип,
                    // а «Квартал» при 13px/600 занимает 55 (UX-17).
                    // Решение владельца продукта 05.08: единый кегль важнее
                    // канонного размера на одном экране из трёх.
                    font: `${on ? 600 : 500} 11px/1 ${FONT}`,
                    color: on ? theme.cherry : C.mid,
                    background: on ? theme.surface : "transparent",
                    boxShadow: on ? "0 1px 3px rgba(17,19,24,0.12)" : "none",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    transition:
                      "background 180ms ease, color 180ms ease, box-shadow 180ms ease",
                  }}
                >
                  {chip}
                </button>
              );
            })}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={() => {
              setShowSearch((s) => !s);
              if (showSearch) setSearch("");
            }}
            aria-label="Поиск"
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              display: "flex",
            }}
          >
            <Search size={20} color={showSearch ? theme.cherry : theme.fg2} />
          </button>
          {/* Иконка фильтра — как на «Чеках» и «Сводке», тот же компонент.
              В макете рядом с поиском она есть, но без поведения (UX-14);
              состав полей — решение владельца продукта 05.08: период,
              сотрудник, сумма. Статус не дублируем: он в чипах слева. */}
          {FilterIcon && (
            <FilterIcon
              active={filtersActive}
              onClick={() => setShowFilters(true)}
            />
          )}
        </div>
      </div>

      {/* строка поиска — тоже на белой подложке (как на Чеках) */}
      {showSearch && (
        <div
          style={{
            /* T144-эталон (как «Чеки»): без белой подложки и рамки, поле
               surfaceSunk 11/12, зазор 9. Была ЧЕТВЁРТАЯ разновидность
               полосы — нашлась только сплошной описью по src. */
            padding: "10px 16px 22px", /* T142-воздух: до списка 22 */
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "11px 12px",
              gap: 9,
              background: theme.surfaceSunk,
              borderRadius: 10,
            }}
          >
            <Search size={18} color={theme.fg3} aria-hidden="true" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск..."
              aria-label="Поиск по отчётам"
              autoFocus
              style={{
                border: "none",
                outline: "none",
                flex: 1,
                minWidth: 0,
                background: "none",
                padding: 0,
                font: `400 15px/1.2 ${FONT}`,
                color: theme.fg1,
              }}
            />
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "80px 20px",
            gap: 16,
          }}
        >
          <ClipboardList size={44} strokeWidth={1.25} color={theme.fg3} />
          {statusFilter === null || statusFilter === "Черновик" ? (
            <Btn onClick={openCreate}>Создать первый отчёт</Btn>
          ) : (
            <span
              style={{
                color: theme.fg3,
                fontFamily: FONT,
                fontSize: 11,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
              }}
            >
              Отчёты отсутствуют
            </span>
          )}
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            // как на Чеках ("12px 16px 88px"); низ увеличен под FAB
            padding: "12px 16px 130px",
          }}
        >
          {filtered.map((rep) => {
            const badge = BADGE[rep.status] || BADGE["Черновик"];
            // ОДНА КНОПКА НА СТРОКУ, набор зависит от статуса:
            //   Черновик    → Удалить   («Отправить» живёт в деталях)
            //   На проверке → Отозвать
            //   Отклонён    → Удалить   (бэк разрешает: EDITABLE_STATUSES)
            //   Одобрен     → жеста нет вовсе
            //
            // ПОЧЕМУ «ОТПРАВИТЬ» НЕ В СВАЙПЕ — чтобы через месяц не вернули.
            // Две кнопки дают панель 144px, а она уносит СУММУ И БЕЙДЖ
            // ЦЕЛИКОМ на ВСЕХ ширинах, включая 430: они прижаты к правому
            // краю карточки, а панель приходит оттуда же (замер 05.08:
            // 320 → сумма и бейдж «УЙДЁТ», 375 то же, 393 то же, 430 то же;
            // от названия остаётся 79-88%). Смахнув, человек видит огрызок
            // названия и жмёт действие вслепую. Адаптивный вариант
            // «на 320 одна кнопка, на 375+ две» отвергнут теми же числами:
            // он лечит обрезку названия, а не пропажу суммы.
            // Одновременно две кнопки и видимую сумму даёт только перенос
            // суммы левее — то есть переделка карточки, а она из макета.
            //
            // «Исправить» в свайп не идёт по другой причине: это переход
            // к правке, то есть тот же тап по карточке, только другой кнопкой.
            // Дублирование «Отозвать» со свайпом и деталями — осознанное:
            // свайп для быстрого, детали для вдумчивого.
            const actions =
              rep.status === "На проверке"
                ? [
                    {
                      key: "withdraw",
                      label: "Отозвать",
                      Icon: Undo2,
                      bg: "#B45309", // warning-fg канона, как в макете
                      // Отмена не нужна: действие обратимо штатно —
                      // «Отправить» вернёт отчёт на проверку. Тост с «Отменить»
                      // держим только для необратимого удаления.
                      onPress: () => changeStatus(rep.id, "Черновик"),
                    },
                  ]
                : isEditable(rep.status)
                  ? [
                      {
                        key: "del",
                        label: "Удалить",
                        Icon: Trash2,
                        bg: "#B91C1C",
                        onPress: () => removeWithUndo(rep),
                      },
                    ]
                  : [];
            return (
              <SwipeRow
                key={rep.id}
                actions={actions}
                onTap={() => setOpenRep(rep)}
              >
                <div
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    // Клавиатурный путь: тап обрабатывает SwipeRow, а Enter/Пробел
                    // сюда, потому что у жеста клавиатурного эквивалента нет.
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") setOpenRep(rep);
                  }}
                  style={{
                    background: theme.surface,
                    padding: "14px 16px",
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 5,
                        minWidth: 0,
                        flex: 1,
                      }}
                    >
                      <div
                        style={{
                          font: `600 17px/1.25 ${FONT}`,
                          color: C.dark,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {rep.title}
                      </div>
                      <div
                        style={{
                          font: `400 13px/1.2 ${FONT}`,
                          color: theme.fg2,
                          fontVariantNumeric: "tabular-nums",
                          // Как в макете (.card .meta): строка не переносится,
                          // лишнее уходит в многоточие. Без этого автор
                          // («Шукалович А.») уводит мету на вторую строку
                          // и карточка растёт — проверено предпросмотром.
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {fmtDate(rep.created)} · {(rep.receiptIds || []).length}{" "}
                        {plural((rep.receiptIds || []).length, [
                          "чек",
                          "чека",
                          "чеков",
                        ])}
                        {/* Автор — как в макете («дата · N чеков · Фамилия И.»),
                            но ТОЛЬКО тем, кто видит чужие отчёты. Сотруднику
                            бэк отдаёт лишь его собственные (REP-ACL), и автор
                            в каждой строке был бы одинаковый — шум. В макете
                            это лист бухгалтера.
                            Пустой user_id (старые отчёты) не показываем вовсе:
                            ни прочерка, ни «—» — решение владельца продукта. */}
                        {canApprove(role) && authorName(rep.user_id)
                          ? ` · ${authorName(rep.user_id)}`
                          : ""}
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-end",
                        gap: 7,
                        flexShrink: 0,
                      }}
                    >
                      <div
                        style={{
                          font: `700 15px/1.2 ${FONT}`,
                          color: C.dark,
                          fontVariantNumeric: "tabular-nums",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {money(rep.total)}
                      </div>
                      <span
                        style={{
                          font: `500 12px/1 ${FONT}`,
                          padding: "5px 10px",
                          borderRadius: 999,
                          whiteSpace: "nowrap",
                          background: badge.bg,
                          color: badge.color,
                        }}
                      >
                        {rep.status}
                      </span>
                    </div>
                  </div>
                </div>
              </SwipeRow>
            );
          })}
        </div>
      )}

      {/* FAB «+» — создание отчёта (заменяет кнопку «+ Новый») */}
      <button
        onClick={openCreate}
        aria-label="Новый отчёт"
        style={{
          ...fabHiddenStyle(fabHidden),
          position: "fixed",
          right: 16,
          bottom: "calc(env(safe-area-inset-bottom, 0px) + 84px)",
          width: 56,
          height: 56,
          borderRadius: 999,
          background: theme.cherry,
          boxShadow: "0 2px 8px rgba(17,19,24,.16)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "none",
          cursor: "pointer",
          // Тот же слой, что у кнопки на «Чеках»: обе плавающие кнопки
          // живут на 40 и обязаны быть ниже любого оверлея.
          // Диапазоны — в CLAUDE.md, раздел «Слои интерфейса».
          zIndex: 40,
        }}
      >
        <Plus size={26} color="#fff" />
      </button>

      {/* Детали отчёта: состав, суммы, «убрать чек» и — только здесь —
          «Одобрить»/«Отклонить». */}
      {openRep && (
        <ReportDetailModal
          report={openRep}
          onClose={() => setOpenRep(null)}
          role={role}
          reloadReceipts={reloadReceipts}
          onChanged={(updated) => {
            // Ответ ручек состава — форма элемента списка (T7), поэтому
            // подставляем как есть и в список, и в открытую карточку.
            setReports((prev) =>
              prev.map((r) => (r.id === updated.id ? updated : r)),
            );
            setOpenRep((prev) =>
              prev && prev.id === updated.id ? { ...prev, ...updated } : prev,
            );
          }}
          onStatus={async (id, status) => {
            const updated = await changeStatus(id, status);
            // Детали НЕ закрываем: пользователь смотрит состав и после смены
            // статуса чаще всего продолжает смотреть. Раньше экран схлопывался
            // после «Одобрить», и чтобы просто отправить черновик, приходилось
            // выходить в список — ровно то, из-за чего действия автора сюда
            // и добавлены. Ошибку показал changeStatus тостом, updated пуст —
            // тогда ничего не трогаем.
            if (updated)
              setOpenRep((prev) => (prev ? { ...prev, ...updated } : prev));
          }}
          onDelete={(rep) => {
            // Из деталей удаляют тем же путём, что свайпом: строка исчезает,
            // запрос уходит отложенно, пока висит тост с «Отменить».
            // Подтверждения нет ни там, ни здесь — иначе одно действие вело бы
            // себя по-разному в двух местах.
            removeWithUndo(rep);
          }}
        />
      )}

      {showFilters && FiltersModal && (
        <FiltersModal
          dateBuilder
          from={fFrom}
          to={fTo}
          amount={{ from: fAmtFrom, to: fAmtTo }}
          // Секция «Сотрудник» — только тем, кто видит чужие отчёты.
          // Сотруднику бэк отдаёт лишь его собственные (REP-ACL), фильтр
          // по автору для него всегда одно и то же значение.
          employees={canApprove(role) ? users : undefined}
          selectedEmployee={fEmp}
          onApply={(r) => {
            setFFrom(r.from || "");
            setFTo(r.to || "");
            setFEmp(r.employee);
            setFAmtFrom(r.amountFrom == null ? "" : String(r.amountFrom));
            setFAmtTo(r.amountTo == null ? "" : String(r.amountTo));
          }}
          onReset={() => {
            setFFrom("");
            setFTo("");
            setFEmp(null);
            setFAmtFrom("");
            setFAmtTo("");
          }}
          onClose={() => setShowFilters(false)}
        />
      )}

      {showC && (
        <Modal
          title="Новый отчёт"
          onClose={() => setShowC(false)}
          footer={
            <Btn
              full
              onClick={create}
              disabled={!title || !selected.length}
              loading={isSubmitting}
            >
              {isSubmitting ? "Создаю…" : "Создать отчёт"}
            </Btn>
          }
        >
          <div style={{ paddingTop: 12 }}>
            <RuleInput
              label="Название отчёта"
              value={title}
              onChange={setTitle}
              placeholder="Командировка, май 2026"
            />
            <div
              style={{
                fontSize: 11, // T139: было 9 — четвёртая подпись, единый размер
                letterSpacing: "0.15em",
                textTransform: "uppercase",
                color: theme.fg2,
                marginBottom: 8,
                fontFamily: FONT,
              }}
            >
              Выберите чеки · {selected.length} выбрано
            </div>
            {/* T148 ①: период ПРЯЧЕТ строки списка, не трогая уже выбранное
                в другом месяце — фильтр не имеет права терять состояние (T99,
                тот же класс). «Выбрать все» действует только на видимое. */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginBottom: 10,
              }}
            >
              {РЕЖИМЫ_ПЕРИОДА.map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setПериод(v)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 999,
                    border: `1px solid ${период === v ? theme.cherry : theme.border}`,
                    background: период === v ? theme.cherryTint : theme.surface,
                    color: период === v ? theme.cherry : theme.fg2,
                    font: `500 12px/1.2 ${FONT}`,
                    cursor: "pointer",
                  }}
                >
                  {l}
                </button>
              ))}
            </div>
            {(() => {
              const видимые = free.filter((r) => вПериоде(r.date, период));
              if (!видимые.length) return null;
              const всеВыбраны = видимые.every((r) => selected.includes(r.id));
              const сумма = видимые.reduce((s, r) => s + Number(r.amount), 0);
              return (
                <button
                  type="button"
                  onClick={() =>
                    setSelected((prev) =>
                      всеВыбраны
                        ? prev.filter((id) => !видимые.some((r) => r.id === id))
                        : [
                            ...prev,
                            ...видимые
                              .map((r) => r.id)
                              .filter((id) => !prev.includes(id)),
                          ],
                    )
                  }
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    textAlign: "left",
                    padding: "9px 12px",
                    marginBottom: 10,
                    borderRadius: 8,
                    border: `1px dashed ${theme.border}`,
                    background: theme.surfaceSunk,
                    color: theme.fg1,
                    font: `500 12.5px/1.3 ${FONT}`,
                    cursor: "pointer",
                  }}
                >
                  {всеВыбраны
                    ? `Снять все за период (${видимые.length})`
                    : `Выбрать все за период: ${видимые.length} · ${money(сумма)}`}
                </button>
              );
            })()}
            {/* Три разных «пусто» — причина у них разная, и подсказка тоже:
                ждём профиль · своих чеков нет вовсе · все уже разложены. */}
            {free.length === 0 && (
              <Block>
                <span style={{ fontFamily: FONT, fontSize: 12, color: C.mid }}>
                  {userId == null
                    ? "Загружаем ваши чеки…"
                    : myReceipts.length === 0
                      ? "У вас пока нет чеков. В отчёт попадают только собственные — чужие приложить нельзя"
                      : "Все ваши чеки уже разложены по отчётам"}
                </span>
              </Block>
            )}
            {free.map((r) => {
              if (!вПериоде(r.date, период)) return null;
              const sel = selected.includes(r.id);
              return (
                <div
                  key={r.id}
                  onClick={() =>
                    setSelected((prev) =>
                      sel ? prev.filter((x) => x !== r.id) : [...prev, r.id],
                    )
                  }
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "9px 10px",
                    marginBottom: 4,
                    border: `1px solid ${sel ? theme.cherry : theme.border}`,
                    background: sel ? theme.cherrySoft : theme.surface,
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      width: 12,
                      height: 12,
                      border: `1.5px solid ${
                        sel ? theme.cherry : theme.border
                      }`,
                      background: sel ? theme.cherry : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: theme.surface,
                      fontSize: 10,
                      flexShrink: 0,
                      borderRadius: 3,
                    }}
                  >
                    {sel && "✓"}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontFamily: FONT,
                        fontSize: 13,
                        color: C.dark,
                        fontWeight: 700,
                      }}
                    >
                      {shortOrg(r.org)}
                    </div>
                    <div
                      style={{
                        fontFamily: FONT,
                        fontSize: 10,
                        color: theme.fg2,
                      }}
                    >
                      {fmtDate(r.date)} · {catName(r)}
                    </div>
                  </div>
                  <span
                    style={{
                      fontFamily: FONT,
                      fontSize: 13,
                      color: theme.cherry,
                      fontWeight: 700,
                    }}
                  >
                    {money(r.amount)}
                  </span>
                </div>
              );
            })}
            {selected.length > 0 && (
              <Block>
                <div
                  style={{ display: "flex", justifyContent: "space-between" }}
                >
                  <span
                    style={{ fontFamily: FONT, fontSize: 11, color: theme.fg2 }}
                  >
                    Итого:
                  </span>
                  <span
                    style={{
                      fontFamily: FONT,
                      fontSize: 14,
                      color: theme.cherry,
                      fontWeight: 700,
                    }}
                  >
                    {money(
                      free
                        .filter((r) => selected.includes(r.id))
                        .reduce((s, r) => s + Number(r.amount), 0),
                    )}
                  </span>
                </div>
              </Block>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
