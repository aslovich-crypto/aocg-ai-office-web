// ⚠️ ОБЩАЯ ОБОЛОЧКА ШТОРКИ-ВОПРОСА (REP-SWIPE1C, 23.09.2026). Вопросов у нас
// уже два — «Удалить отчёт?» и «Отправить в 1С?», — и оба живут в двух местах
// каждый. Четыре копии одной разметки разошлись бы молча: ровно так разошлись
// подтверждения у чека и у отчёта, и лечилось это вынесением общего.
//
// ⚠️ ЗДЕСЬ ТОЛЬКО ФОРМА, А НЕ СМЫСЛ. Заголовок, текст и вид кнопки действия
// приходят снаружи: «Удалить» красная, «Отправить в 1С» вишнёвая — это разные
// действия, и одинаковыми им быть нельзя. Общее у них ровно то, что не несёт
// смысла: положение, подложка, слой, ширина, безопасная зона, левая «Отмена».
//
// ⚠️ СЛОЙ 300 — по РОЛИ из таблицы слоёв правил фронта: 300–399 «подтверждения
// поверх полноэкранного». `fixed`, потому что шторку открывают и из списка,
// где никакой карточки нет вовсе.
import { theme, FONT } from "../lib/theme";
import { шторкаОтмена } from "../lib/cardUi";

export default function AskSheet({
  заголовок,
  занято,
  // ⚠️ `нельзя` — кнопка действия погашена, но шторка жива (REP-RENAME).
  // Отличается от `занято`: там запрос в пути и гасится ВСЁ, здесь человек
  // ещё не дал того, без чего действие бессмысленно.
  нельзя,
  onKeep,
  onConfirm,
  стильДействия,
  подписьДействия,
  подписьЗанято,
  подписьОтмены = "Отмена",
  children,
}) {
  return (
    <div
      onClick={() => !занято && onKeep()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 300,
        background: "rgba(22,26,29,0.5)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={заголовок}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: theme.surface,
          borderRadius: "16px 16px 0 0",
          padding: "18px 16px calc(16px + env(safe-area-inset-bottom))",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          // Оболочка приложения центрирует содержимое по ширине телефона,
          // но шторка лежит ВНЕ её потока (fixed) — ширину держим сами.
          width: "100%",
          maxWidth: 480,
          boxSizing: "border-box",
          margin: "0 auto",
        }}
      >
        <div style={{ font: `600 17px/1.3 ${FONT}`, color: theme.fg1 }}>
          {заголовок}
        </div>
        {children}
        <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
          <button
            type="button"
            onClick={onKeep}
            disabled={занято}
            style={шторкаОтмена}
          >
            {подписьОтмены}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={занято || нельзя}
            style={{
              ...стильДействия,
              opacity: нельзя ? 0.45 : 1,
              cursor: занято || нельзя ? "default" : "pointer",
            }}
          >
            {занято ? подписьЗанято : подписьДействия}
          </button>
        </div>
      </div>
    </div>
  );
}
