import { useState, useEffect } from "react";

import { useFabHidden, fabHiddenStyle } from "../hooks/useFabHidden";
import { ClipboardList, Plus, Search, Trash2 } from "lucide-react";

import { C, FONT, theme } from "../lib/theme";
import { shortOrg, fmtDate } from "../lib/format";
import { catName } from "../lib/categories";
import { BADGE, isEditable } from "../lib/reports";
import ReportDetailModal from "../components/ReportDetailModal";
import SwipeRow from "../components/SwipeRow";

// Экран «Отчёты» — вёрстка по макету templates/reports/Отчёты.html (ЧП2, INT).
// Логика (статусы, PATCH, создание) — из кода, вёрстка — из макета.
// Зависимости монолита (authFetch, fmt, Btn, Modal, RuleInput, Block)
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
  userId,
  role, // ЧП5б: гейт «Одобрить/Отклонить» в деталях отчёта
  authFetch,
  reloadReceipts, // после удаления отчёта его чеки освободились
  fmt,
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
  // Открытый отчёт (детали). Одобрение/отклонение живёт ТОЛЬКО там —
  // чтобы решение принимали, увидев состав, а не вслепую из списка.
  const [openRep, setOpenRep] = useState(null);
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

  const filtered = reports.filter(
    (r) =>
      (!statusFilter || r.status === statusFilter) &&
      (!search || r.title.toLowerCase().includes(search.toLowerCase())),
  );

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
                    font: `${on ? 600 : 500} 13px/1 ${FONT}`,
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
        </div>
      </div>

      {/* строка поиска — тоже на белой подложке (как на Чеках) */}
      {showSearch && (
        <div
          style={{
            background: theme.surface,
            borderBottom: `1px solid ${theme.border}`,
            padding: "0 16px 10px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              border: "1px solid #EEF0F4",
              padding: "8px 12px",
              gap: 8,
              background: "#F6F7F9",
              borderRadius: 10,
            }}
          >
            <Search size={14} color={theme.fg3} />
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
                fontSize: 13,
                background: "none",
                fontFamily: FONT,
                color: C.dark,
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
            // Свайп несёт ТОЛЬКО удаление, и только там, где его разрешает бэк
            // (EDITABLE_STATUSES: черновик и отклонённый; в остальных 409).
            // Остальные действия автора — «Отправить», «Отозвать», «Исправить» —
            // живут внутри открытого отчёта: отправлять состав, не заглянув
            // в него, странно, а удалить черновик хочется быстро (решение 05.08).
            const actions = isEditable(rep.status)
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
                        }}
                      >
                        {fmtDate(rep.created)} · {(rep.receiptIds || []).length}{" "}
                        {plural((rep.receiptIds || []).length, [
                          "чек",
                          "чека",
                          "чеков",
                        ])}
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
                        {fmt(rep.total)}
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
                fontSize: 9,
                letterSpacing: "0.15em",
                textTransform: "uppercase",
                color: theme.fg2,
                marginBottom: 8,
                fontFamily: FONT,
              }}
            >
              Выберите чеки · {selected.length} выбрано
            </div>
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
                    {fmt(r.amount)}
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
                    {fmt(
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
