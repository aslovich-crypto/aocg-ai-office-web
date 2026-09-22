// ⚠️ ПОДТВЕРЖДЕНИЕ ОТМЕНЫ ОТПРАВКИ В 1С — СВОЕЙ ШТОРКОЙ (1C-29 ②а, решение
// владельца 22.09.2026, В3). Системное окно запрещено сторожем native-dialogs.
// Предупреждение — словами бэкенда: отмена снимает НАШУ запись об отправке,
// документ в 1С остаётся, и после повторной отправки их станет два.
//
// Отдельным файлом, а не в карточке отчёта: карточка уже больше тысячи строк,
// и монолит по правилу фронта не растим.
//
// Слой 6 — выше шторки добавления чеков и плашки «Отменить» (обе 5) внутри
// карточки: это вопрос поверх всего её содержимого. Шторка лежит в панели
// карточки (position: relative), поэтому закрывает панель, а не окно.
//
// Стили кнопок приходят из карточки (её BTN), чтобы одно и то же действие
// не описывалось дважды и не разошлось по виду.
import { theme, FONT } from "../lib/theme";

export default function Cancel1CSheet({
  документ,
  занято,
  onKeep,
  onCancel,
  кнопки,
}) {
  return (
    <div
      onClick={() => !занято && onKeep()}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 6,
        background: "rgba(22,26,29,0.5)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label="Отменить отправку в 1С?"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: theme.surface,
          borderRadius: "16px 16px 0 0",
          padding: "18px 16px calc(16px + env(safe-area-inset-bottom))",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ font: `600 17px/1.3 ${FONT}`, color: theme.fg1 }}>
          Отменить отправку в 1С?
        </div>
        <div style={{ font: `400 14px/1.45 ${FONT}`, color: theme.fg2 }}>
          {документ
            ? `Документ ${документ} в 1С останется`
            : "Документ в 1С, если он там есть, останется"}
          {
            " — удалите его в 1С сами, иначе после повторной отправки их станет два."
          }
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
          <button onClick={onKeep} disabled={занято} style={кнопки.оставить}>
            Не отменять
          </button>
          <button
            onClick={onCancel}
            disabled={занято}
            style={{
              ...кнопки.отменить,
              cursor: занято ? "default" : "pointer",
            }}
          >
            {занято ? "Отменяем…" : "Отменить отправку"}
          </button>
        </div>
      </div>
    </div>
  );
}
