import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { FONT, theme } from "../lib/theme";
import { canApprove } from "../lib/reports";
import { useModalA11y } from "../hooks/useModalA11y";
import ReportDetailModal from "./ReportDetailModal";

// ⚠️ ШТОРКА УВЕДОМЛЕНИЙ ВЫНЕСЕНА ИЗ App.jsx 10.09.2026 (T159, блок Б),
// и вынесена не ради порядка в файле, а ПОТОМУ ЧТО ИНАЧЕ НЕ ПОСТАВИТЬ
// `useModalA11y`: хук нельзя звать условно, а разметка жила внутри
// `{показатьУведомления && (…)}`. Замер аудита 10.09: это была
// ЕДИНСТВЕННАЯ модалка приложения без хука — он вызван в двенадцати местах,
// здесь не был. Клавиатурой шторку нельзя было закрыть ничем: Escape
// не слушался, фокус внутрь не переносился, подложка закрывалась мышью.
//
// ⚠️ ЭКРАНА УВЕДОМЛЕНИЙ В КАНОНЕ НЕТ НИ ОДНОГО (в макетах шесть страниц,
// этой среди них нет) — канон нарисовал индикатор, не нарисовав того, что
// за ним. Отступление именованное: ЭкранУведомленийВнеКанона. Форма взята
// у существующих шторок приложения, чтобы не изобретать новый язык.
export default function NotificationsSheet({ уведомления, role, onClose }) {
  // ⚠️ ОТЧЁТ ОТКРЫВАЕТСЯ СКЕЛЕТОМ {id, title}, ОСТАЛЬНОЕ ГРУЗИТ САМА
  // КАРТОЧКА — тот же приём, что в карточке чека (ReceiptDetailModal:1699).
  // Название берём заглушкой «Отчёт»: у события его нет отдельным полем,
  // а разбирать заголовок по «: » значило бы привязать фронт к тексту,
  // который пишет бэкенд, — они разъедутся при первой же правке слов.
  const [openReport, setOpenReport] = useState(null);
  const ref = useModalA11y(onClose);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: "rgba(17,19,24,.35)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Уведомления"
        onClick={(е) => е.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 480,
          maxHeight: "78dvh",
          overflowY: "auto",
          background: theme.surface,
          borderRadius: "16px 16px 0 0",
          padding: "16px 16px calc(env(safe-area-inset-bottom) + 20px)",
          // width:100% вместе с padding при content-box делает элемент
          // ШИРЕ родителя всегда — сторож вёрстки (T14) поймал это сразу.
          boxSizing: "border-box",
          outline: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <span style={{ font: `600 17px/1.2 ${FONT}`, color: "#111318" }}>
            Уведомления
          </span>
          <button
            onClick={onClose}
            aria-label="Закрыть"
            style={{
              border: "none",
              background: "none",
              font: `400 15px/1 ${FONT}`,
              color: theme.fg2,
              cursor: "pointer",
              padding: 6,
            }}
          >
            Закрыть
          </button>
        </div>

        {/* ⚠️ ПУСТО — ЭТО ТОЖЕ ОТВЕТ, и он честный: список работает,
            событий пока нет. Отличается от прежнего «Уведомления — скоро»,
            которое обещало несделанное.
            ⚠️ ТЕКСТ РАЗВЕДЁН ПО РОЛЯМ 10.09.2026: управляющему приходят
            НЕ «решения по вашим отчётам», а отчёты на проверку и новые
            сотрудники. Прежняя фраза была верна ровно для сотрудника —
            то есть врала бухгалтеру и админу, которым колокольчик нужнее. */}
        {уведомления.length === 0 ? (
          <div
            style={{
              font: `400 14px/1.5 ${FONT}`,
              color: theme.fg2,
              padding: "18px 4px 24px",
              textAlign: "center",
            }}
          >
            Пока ничего нового.
            <br />
            {canApprove(role)
              ? "Здесь появятся отчёты на проверку и новые сотрудники."
              : "Здесь появятся решения по вашим отчётам."}
          </div>
        ) : (
          уведомления.map((н) => {
            // ⚠️ КЛИКАБЕЛЬНО ТОЛЬКО ТО, КУДА ЕСТЬ КУДА ВЕСТИ. `report_id`
            // ехал по всей дороге — колонка в базе, поле в ответе ручки —
            // и умирал на экране: строка была `<div>` без обработчика.
            // Человек с «отчёт отклонён» закрывал шторку и искал отчёт
            // руками. У события о новом сотруднике `report_id` пустой,
            // и строка остаётся обычной — мёртвая кнопка хуже её отсутствия.
            const кликабельна = Boolean(н.report_id);
            const Тег = кликабельна ? "button" : "div";
            return (
              <Тег
                key={н.id}
                type={кликабельна ? "button" : undefined}
                onClick={
                  кликабельна
                    ? () => setOpenReport({ id: н.report_id, title: "Отчёт" })
                    : undefined
                }
                style={{
                  width: "100%",
                  // width:100% вместе с padding при content-box делает
                  // элемент шире родителя — сторож вёрстки (T14) поймал
                  // это на первом же прогоне.
                  boxSizing: "border-box",
                  textAlign: "left",
                  border: "none",
                  background: "none",
                  padding: "12px 0",
                  borderBottom: `1px solid ${theme.border}`,
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  cursor: кликабельна ? "pointer" : "default",
                  font: "inherit",
                }}
              >
                {/* Непрочитанное отмечено точкой у строки — той же вишнёвой,
                    что на колокольчике: один цвет, один смысл. */}
                <span
                  style={{
                    flexShrink: 0,
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    marginTop: 6,
                    background: н.read ? "transparent" : theme.cherry,
                  }}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      font: `${н.read ? 400 : 600} 14px/1.35 ${FONT}`,
                      color: "#111318",
                    }}
                  >
                    {н.title}
                  </div>
                  {н.body && (
                    <div
                      style={{
                        marginTop: 3,
                        font: `400 13px/1.4 ${FONT}`,
                        color: theme.fg2,
                        wordBreak: "break-word",
                      }}
                    >
                      {н.body}
                    </div>
                  )}
                </div>
                {/* Шеврон читается как «здесь есть куда перейти» — тот же
                    приём, что у отчёта в карточке чека. */}
                {кликабельна && (
                  <ChevronRight
                    size={16}
                    color={theme.fg2}
                    style={{ flexShrink: 0, marginTop: 4 }}
                  />
                )}
              </Тег>
            );
          })
        )}
      </div>

      {openReport && (
        <ReportDetailModal
          report={openReport}
          onClose={() => setOpenReport(null)}
          role={role}
          zIndex={180}
        />
      )}
    </div>
  );
}
