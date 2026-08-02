import { useState, useEffect, useRef } from "react";
import { ChevronLeft, X, Undo2 } from "lucide-react";

import { C, FONT, theme } from "../lib/theme";
import { shortOrg, fmtDate, fmtDateTime } from "../lib/format";
import { catName, catColor } from "../lib/categories";
import { useModalA11y } from "../hooks/useModalA11y";
import { authFetch } from "../lib/api";
import { BADGE, isEditable, FROZEN_HINT, canApprove } from "../lib/reports";

// Детали отчёта — полноэкранная карточка по образцу «Детали чека».
// ЗАЧЕМ ЭКРАН СУЩЕСТВУЕТ: без него бухгалтер одобрял вслепую — в списке видно
// только название, сумму и «N чеков», а по этому документу возмещают деньги.
// Поэтому «Одобрить»/«Отклонить» живут ТОЛЬКО здесь: чтобы принять решение,
// отчёт нужно открыть и увидеть состав. В списке остаются действия автора над
// своим документом (отправить, отозвать, исправить, удалить) — они не требуют
// изучения состава.

const money = (n) =>
  Number(n || 0).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + " ₽";

// Время покупки различает похожие чеки лучше всего (UX-4): у одного продавца
// за день накапливаются чеки с близкими суммами, и минуты — единственное,
// что их надёжно разводит. Показываем именно здесь, где состав проверяют.
function receiptWhen(r) {
  if (r.datetime) return fmtDateTime(r.datetime);
  return fmtDate(r.date);
}

// Что показать внизу экрана у отчёта «На проверке». Кнопок нет — объясняем
// причину, иначе пустой низ читается как поломка.
const FOOTER_NOTE = {
  elsewhere: "Отчёт ждёт решения — одобряют и отклоняют в разделе «Отчёты»",
  noRights: "Отчёт на проверке у бухгалтера",
};

// Единственный узел решения: кнопки, объяснение или ничего.
// Порядок веток важен — сначала право, потом место. Иначе сотруднику,
// открывшему отчёт из карточки чека, написали бы «одобряют в разделе
// „Отчёты“», хотя одобрить он не может нигде.
function footerFor({ status, role, onStatus }) {
  if (status !== "На проверке") return null;
  // Роль ещё не пришла (/api/users/me в полёте): не рисуем ни кнопок, ни
  // «нет прав». Показать отказ по незагруженным данным — соврать, а потом
  // молча переобуться, когда роль придёт.
  if (role == null) return null;
  if (!canApprove(role)) return "noRights";
  return onStatus ? "buttons" : "elsewhere";
}

export default function ReportDetailModal({
  // Отчёт: из списка приходит целиком (показываем сразу, без спиннера), из
  // карточки чека — «скелетом» {id, title}: в чеке есть только report_id и
  // report_title. Всё остальное дорисовывается ответом GET /{id}.
  report,
  onClose,
  onChanged, // обновлённый отчёт → в список (из карточки чека не нужен)
  onStatus, // (id, status) → смена статуса; НЕ передан — решения тут не принимают
  role, // роль текущего юзера; null = ещё не загрузилась (не «нет прав»)
  reloadReceipts, // состав изменился → чек освободился/занялся
  zIndex = 120, // из карточки чека открываемся поверх неё (у неё 150)
}) {
  const [full, setFull] = useState(null); // ответ GET /{id}
  const [loadErr, setLoadErr] = useState("");
  const [busyId, setBusyId] = useState(null); // чек, который сейчас убирают
  // Отменяемое удаление: вернуть чек руками дорого (искать среди десятков
  // свободных), поэтому вместо подтверждения ДО — отмена ПОСЛЕ.
  const [undo, setUndo] = useState(null); // {receiptId, org, until}
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Загрузка деталей. Пока идёт — на экране данные из списка.
  useEffect(() => {
    queueMicrotask(async () => {
      try {
        const res = await authFetch(`/api/reports/${report.id}`);
        if (!aliveRef.current) return;
        if (!res.ok) {
          setLoadErr(
            res.status === 404
              ? "Отчёт не найден — возможно, он удалён"
              : "Не удалось загрузить состав отчёта",
          );
          return;
        }
        const data = await res.json();
        if (aliveRef.current) setFull(data);
      } catch {
        if (aliveRef.current) setLoadErr("Нет связи с сервером");
      }
    });
  }, [report.id]);

  // Автоскрытие плашки «Отменить» через 6 секунд.
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 6000);
    return () => clearTimeout(t);
  }, [undo]);

  const rep = full || report;
  const badge = BADGE[rep.status] || BADGE["Черновик"];
  const editable = isEditable(rep.status);
  const hint = FROZEN_HINT[rep.status];
  const ids = (full && full.receiptIds) || report.receiptIds || [];
  // Что уже известно. Открылись из карточки чека — до ответа GET знаем только
  // название, поэтому пустой бейдж, «от » без даты и «0,00 ₽» не рисуем:
  // выдуманные ноль и пустота хуже честного прочерка.
  const idsKnown = !!(full || report.receiptIds);
  // Развёрнутые чеки приходят только из GET /{id}; ручки состава отдают форму
  // элемента списка — с receiptIds, но без receipts. Поэтому full.receipts —
  // это КЭШ загруженных чеков, из него ничего не вычёркиваем, а видимый список
  // считаем по актуальным receiptIds. Так убранный чек пропадает сразу, а
  // «Отменить» возвращает строку без повторного запроса.
  const cached = (full && full.receipts) || [];
  const receipts = cached.filter((r) => ids.includes(r.id));
  // Часть чеков может быть не видна: A-ACL скрывает чужие (сотрудник видит
  // только свои). Молчать нельзя — иначе сумма не сойдётся с видимым списком.
  const hiddenCount = Math.max(0, ids.length - receipts.length);

  function applyUpdated(updated) {
    // updated без receipts — кэш из prev сохраняется мержем.
    setFull((prev) => ({ ...(prev || {}), ...updated }));
    if (onChanged) onChanged(updated);
    if (reloadReceipts) reloadReceipts();
  }

  async function api(path, opts, onOk) {
    try {
      const res = await authFetch(path, opts);
      if (!aliveRef.current) return;
      if (!res.ok) {
        let detail = "";
        try {
          const body = await res.json();
          if (typeof body?.detail === "string") detail = body.detail;
        } catch {
          /* пустое тело */
        }
        setLoadErr(detail || "Не удалось изменить состав отчёта");
        return;
      }
      // DELETE состава и POST состава отдают 200 С ТЕЛОМ — обновлённый отчёт
      // (в отличие от DELETE самого отчёта, который 204 без тела).
      const updated = await res.json();
      if (!aliveRef.current) return;
      setLoadErr("");
      onOk(updated);
    } catch {
      if (aliveRef.current) setLoadErr("Нет связи с сервером");
    }
  }

  async function removeReceipt(rc) {
    if (busyId) return;
    setBusyId(rc.id);
    await api(
      `/api/reports/${rep.id}/receipts/${rc.id}`,
      { method: "DELETE" },
      (updated) => {
        applyUpdated(updated);
        setUndo({ receiptId: rc.id, org: shortOrg(rc.org) });
      },
    );
    if (aliveRef.current) setBusyId(null);
  }

  async function undoRemove() {
    if (!undo || busyId) return;
    const rid = undo.receiptId;
    setBusyId(rid);
    await api(
      `/api/reports/${rep.id}/receipts`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiptIds: [rid] }),
      },
      (updated) => {
        applyUpdated(updated);
        setUndo(null);
      },
    );
    if (aliveRef.current) setBusyId(null);
  }

  const footer = footerFor({ status: rep.status, role, onStatus });

  const dialogRef = useModalA11y(onClose);

  return (
    // Два слоя, как в «Деталях чека»: fixed-оверлей во весь вьюпорт + панель
    // телефонной ширины по центру. Одним слоем нельзя: position:fixed выходит
    // из потока оболочки приложения (maxWidth 480, margin auto в App.jsx),
    // и на десктопе экран растягивался на всю ширину окна, в отличие от всех
    // остальных экранов и модалок.
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex,
        background: "rgba(22,26,29,0.5)",
        display: "flex",
        alignItems: "stretch",
        justifyContent: "center",
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Отчёт «${rep.title}»`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          // relative обязателен: плашка «Чек убран · Отменить» позиционируется
          // absolute и без него уехала бы к краю окна, а не панели.
          position: "relative",
          width: "100%",
          maxWidth: 480,
          background: theme.bg,
          display: "flex",
          flexDirection: "column",
          outline: "none",
        }}
      >
        {/* шапка */}
        <div
          style={{
            background: C.white,
            borderBottom: `1px solid ${C.silver}`,
            padding: "calc(env(safe-area-inset-top) + 8px) 8px 8px",
            display: "flex",
            alignItems: "center",
            gap: 4,
            flexShrink: 0,
          }}
        >
          <button
            onClick={onClose}
            aria-label="Назад"
            style={{
              display: "flex",
              alignItems: "center",
              background: "none",
              border: "none",
              cursor: "pointer",
              color: C.dark,
              padding: 8,
            }}
          >
            <ChevronLeft size={22} />
          </button>
          <span style={{ font: `600 17px/1.2 ${FONT}`, color: C.dark }}>
            Отчёт
          </span>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px 90px" }}>
          {/* заголовок + статус + итог */}
          <div
            style={{
              background: C.white,
              borderRadius: 12,
              padding: "16px",
              boxShadow: "0 1px 3px rgba(17,19,24,.08)",
            }}
          >
            <div style={{ font: `700 19px/1.3 ${FONT}`, color: C.dark }}>
              {rep.title}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginTop: 8,
                flexWrap: "wrap",
              }}
            >
              {rep.status && (
                <span
                  style={{
                    font: `600 12px/1 ${FONT}`,
                    padding: "5px 10px",
                    borderRadius: 999,
                    background: badge.bg,
                    color: badge.color,
                  }}
                >
                  {rep.status}
                </span>
              )}
              {rep.created && (
                <span style={{ font: `400 13px/1 ${FONT}`, color: C.gray }}>
                  от {fmtDate(rep.created)}
                </span>
              )}
            </div>

            {/* Почему в этом статусе ничего нельзя — вместо мёртвых кнопок */}
            {hint && (
              <div
                style={{
                  marginTop: 10,
                  font: `400 12px/1.45 ${FONT}`,
                  color: "#B45309",
                  background: "#FFFBEB",
                  border: "1px solid #FDE68A",
                  borderRadius: 8,
                  padding: "8px 10px",
                }}
              >
                {hint}
              </div>
            )}

            {/* Сумма — из total (его считает бэк по составу), а НЕ по видимым
              чекам: сотруднику часть состава может быть не видна. */}
            <div
              style={{
                marginTop: 14,
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
              }}
            >
              <span style={{ font: `400 13px/1 ${FONT}`, color: C.gray }}>
                Итого по отчёту
              </span>
              <span
                style={{
                  font: `700 22px/1 ${FONT}`,
                  color: C.dark,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {rep.total != null ? money(rep.total) : "—"}
              </span>
            </div>
          </div>

          {loadErr && (
            <div
              style={{
                marginTop: 12,
                font: `500 13px/1.4 ${FONT}`,
                color: "#B91C1C",
                background: "#FEF2F2",
                border: "1px solid #FECACA",
                borderRadius: 8,
                padding: "10px 12px",
              }}
            >
              {loadErr}
            </div>
          )}

          {/* состав */}
          <div
            style={{
              font: `600 11px/1 ${FONT}`,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: C.gray,
              margin: "20px 2px 8px",
            }}
          >
            Чеки{idsKnown ? ` · ${ids.length}` : ""}
          </div>

          {!full && !loadErr && (
            <div
              style={{
                font: `400 13px/1 ${FONT}`,
                color: C.grayL,
                padding: "14px 2px",
              }}
            >
              Загружаем состав…
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {receipts.map((rc) => (
              <div
                key={rc.id}
                style={{
                  background: C.white,
                  borderRadius: 12,
                  boxShadow: "0 1px 3px rgba(17,19,24,.06)",
                  padding: "12px 14px",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    flexShrink: 0,
                    background: catColor(catName(rc)),
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      font: `600 14px/1.25 ${FONT}`,
                      color: C.dark,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {shortOrg(rc.org)}
                  </div>
                  <div
                    style={{
                      font: `400 12px/1.3 ${FONT}`,
                      color: C.gray,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {receiptWhen(rc)} · {catName(rc)}
                  </div>
                </div>
                <span
                  style={{
                    font: `700 14px/1 ${FONT}`,
                    color: C.dark,
                    fontVariantNumeric: "tabular-nums",
                    whiteSpace: "nowrap",
                  }}
                >
                  {money(rc.amount)}
                </span>
                {/* Убрать чек можно только там, где бэк разрешает менять состав */}
                {editable && (
                  <button
                    onClick={() => removeReceipt(rc)}
                    disabled={busyId === rc.id}
                    aria-label={`Убрать чек ${shortOrg(rc.org)} из отчёта`}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: busyId === rc.id ? "default" : "pointer",
                      color: C.grayL,
                      padding: 4,
                      opacity: busyId === rc.id ? 0.4 : 1,
                      display: "flex",
                      flexShrink: 0,
                    }}
                  >
                    <X size={18} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Часть состава скрыта ролевым фильтром — говорим об этом прямо,
            иначе «Итого» не сойдётся с видимыми строками. */}
          {hiddenCount > 0 && (
            <div
              style={{
                marginTop: 10,
                font: `400 12px/1.45 ${FONT}`,
                color: C.gray,
                background: C.lightGray,
                borderRadius: 8,
                padding: "10px 12px",
              }}
            >
              Ещё {hiddenCount} чек(ов) в отчёте принадлежат другому сотруднику
              и вам недоступны. Сумма выше — по всему составу.
            </div>
          )}

          {full && receipts.length === 0 && hiddenCount === 0 && (
            <div
              style={{
                font: `400 13px/1.4 ${FONT}`,
                color: C.grayL,
                padding: "14px 2px",
              }}
            >
              В отчёте пока нет чеков. Их добавляют из карточки чека —
              «Прикрепить к отчёту»
            </div>
          )}
        </div>

        {/* Плашка отмены: вернуть чек руками дорого (искать среди свободных),
          поэтому даём отмену сразу после действия. */}
        {undo && (
          <div
            style={{
              position: "absolute",
              left: 16,
              right: 16,
              bottom: "calc(env(safe-area-inset-bottom) + 84px)",
              background: C.dark,
              color: C.white,
              borderRadius: 10,
              padding: "12px 14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              boxShadow: "0 6px 20px rgba(17,19,24,.25)",
              zIndex: 5,
            }}
          >
            <span style={{ font: `500 13px/1.3 ${FONT}` }}>
              Чек убран{undo.org ? ` · ${undo.org}` : ""}
            </span>
            <button
              onClick={undoRemove}
              disabled={busyId != null}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "none",
                border: "none",
                color: "#FFD9DA",
                font: `600 13px/1 ${FONT}`,
                cursor: busyId != null ? "default" : "pointer",
                padding: 0,
              }}
            >
              <Undo2 size={16} />
              Отменить
            </button>
          </div>
        )}

        {/* Решение по деньгам — только здесь, после просмотра состава. */}
        {footer === "buttons" && (
          <div
            style={{
              flexShrink: 0,
              background: C.white,
              borderTop: `1px solid ${C.silver}`,
              padding: "12px 16px calc(12px + env(safe-area-inset-bottom))",
              display: "flex",
              gap: 8,
            }}
          >
            <button
              onClick={() => onStatus(rep.id, "Отклонён")}
              style={{
                flex: 1,
                height: 46,
                borderRadius: 8,
                border: "1px solid #FECACA",
                background: C.white,
                color: "#B91C1C",
                font: `600 15px/1 ${FONT}`,
                cursor: "pointer",
              }}
            >
              Отклонить
            </button>
            <button
              onClick={() => onStatus(rep.id, "Одобрен")}
              style={{
                flex: 1,
                height: 46,
                borderRadius: 8,
                border: "none",
                background: "#15803D",
                color: C.white,
                font: `600 15px/1 ${FONT}`,
                cursor: "pointer",
              }}
            >
              ✓ Одобрить
            </button>
          </div>
        )}

        {/* Кнопок нет — объясняем почему. Молчание читалось бы как поломка:
          пользователь видит «На проверке» и пустой низ экрана. */}
        {FOOTER_NOTE[footer] && (
          <div
            style={{
              flexShrink: 0,
              background: C.white,
              borderTop: `1px solid ${C.silver}`,
              padding: "12px 16px calc(12px + env(safe-area-inset-bottom))",
              font: `400 13px/1.4 ${FONT}`,
              color: C.gray,
              textAlign: "center",
            }}
          >
            {FOOTER_NOTE[footer]}
          </div>
        )}
      </div>
    </div>
  );
}
