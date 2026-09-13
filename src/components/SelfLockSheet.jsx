// ⚠️ ПОДТВЕРЖДЕНИЕ ДЕЙСТВИЯ, ПОСЛЕ КОТОРОГО ЧЕЛОВЕК ТЕРЯЕТ ДОСТУП СЕЙЧАС (T137).
//
// ЗАЧЕМ, СЛУЧАЕМ ВЛАДЕЛЬЦА 31.08.2026: он погасил себя свайпом и вернулся
// только через базу. Второй администратор БЫЛ — владелец о нём не помнил.
// Значит не хватало не осторожности, а СВЕДЕНИЯ: кто может вернуть.
//
// ⚠️ ЭТО СВЕДЕНИЕ, А НЕ ВОПРОС, и разница здесь главная. «Вы уверены?»
// нажимается не глядя и не сообщает ничего; имя того, кто вернёт, отвечает
// на единственный вопрос, который возникнет через секунду после нажатия.
//
// ⚠️ ГРАНИЦА ПОСТАВЛЕНА ВЛАДЕЛЬЦЕМ И СУЖЕ, ЧЕМ КАЖЕТСЯ: подтверждение
// только на СЕБЕ и только на двух действиях — погасить себя и понизить себя
// из администраторов. Гашение чужого, удаление сотрудника, понижение
// чужого остаются в одно движение, как сейчас. Спрашивать на всё подряд —
// это обучить человека нажимать «да» вслепую, и тогда предупреждение
// не сработает там, где оно единственное.
//
// ⚠️ ОДИН ДИАЛОГ НА ОБА СЛУЧАЯ, А НЕ ДВЕ КОПИИ (требование владельца
// 13.09.2026). Две копии одного текста у нас уже расходились молча —
// словари, правила, копия скилла. Случаи различаются ровно двумя словами:
// что именно теряется и как называется кнопка.
import { useModalA11y } from "../hooks/useModalA11y";
import { theme, FONT } from "../lib/theme";
import { ктоВернётСловами } from "../lib/self_lock";

// Два случая, и различаются они только этим. Всё остальное — общее.
const СЛУЧАИ = {
  гашение: {
    что: "Вы отключаете свою учётную запись. Доступ пропадёт сразу — и к этому разделу, и ко входу.",
    кнопка: "Отключить себя",
  },
  роль: {
    что: "Вы снимаете с себя права администратора. Управление людьми, ключами и организацией закроется сразу.",
    кнопка: "Снять свои права",
  },
};

export default function SelfLockSheet({
  случай,
  ктоВернёт,
  onConfirm,
  onClose,
  busy,
}) {
  const dialogRef = useModalA11y(onClose);
  const текст = СЛУЧАИ[случай] || СЛУЧАИ.гашение;
  const имена = ктоВернётСловами(ктоВернёт);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: theme.scrim || "rgba(0,0,0,0.3)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 320,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Вы потеряете доступ сразу"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: theme.surface,
          width: "100%",
          boxSizing: "border-box",
          maxWidth: 480,
          borderRadius: "16px 16px 0 0",
          padding: "16px 16px 20px",
          paddingBottom: "env(safe-area-inset-bottom)",
          outline: "none",
        }}
      >
        <div
          style={{
            fontSize: 15,
            fontFamily: FONT,
            color: theme.fg1,
            fontWeight: 600,
            marginBottom: 8,
          }}
        >
          Вы потеряете доступ сразу
        </div>

        <div
          style={{
            fontSize: 13,
            lineHeight: 1.5,
            fontFamily: FONT,
            color: theme.fg2,
            marginBottom: 10,
          }}
        >
          {текст.что}
        </div>

        {/* ⚠️ ИМЕНА — ГЛАВНОЕ В ЭТОМ ОКНЕ, поэтому они отдельным блоком и
            цветом основного текста, а не примечанием под кнопкой. Ради них
            окно и существует. */}
        {имена && (
          <div
            style={{
              background: theme.surfaceSunk,
              border: `1px solid ${theme.border}`,
              borderRadius: 10,
              padding: "10px 12px",
              fontSize: 13,
              lineHeight: 1.5,
              fontFamily: FONT,
              color: theme.fg1,
              marginBottom: 14,
            }}
          >
            Вернуть доступ сможет: {имена}
          </div>
        )}

        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          style={{
            width: "100%",
            // ⚠️ БЕЗ `border-box` кнопка была бы ШИРЕ шторки на 32 px
            // отступов — тот же случай, что поймал сторож вёрстки T14
            // у карточки роли.
            boxSizing: "border-box",
            padding: "12px 16px",
            borderRadius: 12,
            border: "none",
            // Красный, как у «Удалить» в свайпе: то же по последствиям
            // действие и тот же цвет, чтобы человек их связал.
            background: busy ? theme.border : "#B91C1C",
            color: "#fff",
            fontFamily: FONT,
            fontSize: 14,
            fontWeight: 600,
            cursor: busy ? "default" : "pointer",
          }}
        >
          {busy ? "Отключаем…" : текст.кнопка}
        </button>
        <div style={{ height: 8 }} />
        <button
          type="button"
          onClick={onClose}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "12px 16px",
            borderRadius: 12,
            border: `1px solid ${theme.border}`,
            background: theme.surface,
            color: theme.fg1,
            fontFamily: FONT,
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Отмена
        </button>
      </div>
    </div>
  );
}
