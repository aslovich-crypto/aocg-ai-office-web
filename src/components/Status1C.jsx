// Строка «что с отправкой в 1С» в футере одобренного отчёта (1C-29 ②а).
// Текст решает src/lib/export1c.js (строкаСостояния), здесь только вид.
//
// ⚠️ ТРИ СОСТОЯНИЯ ЗАГРУЗКИ, И ОНИ РАЗНЫЕ: ещё не знаем · не загрузилось ·
// знаем. «Не загрузилось» — общая разметка LoadFailure с кнопкой повтора
// (T171): пустое место читалось бы как «не отправлен», и бухгалтер отправил
// бы второй раз. Кнопки «Отправить» при этом нет — её показывают только
// по ответу сервера (можно_отправить). Режим LoadFailure полный, не
// компактный: компактный пишет «это не значит, что их нет» — про список,
// а здесь одно состояние.
import { theme, FONT } from "../lib/theme";
import { строкаСостояния } from "../lib/export1c";
import LoadFailure from "./LoadFailure";

// Цвета — только токены ДС. У «нейтрального» своей тройки нет: берём ту же
// пару, что у бейджа «Черновик» и плашки скрытых чеков (surfaceSunk / fg2).
const ТОН = {
  success: { bg: theme.successBg, fg: theme.successFg, bd: theme.successBd },
  warning: { bg: theme.warningBg, fg: theme.warningFg, bd: theme.warningBd },
  error: { bg: theme.errorBg, fg: theme.errorFg, bd: theme.errorBd },
  info: { bg: theme.infoBg, fg: theme.infoFg, bd: theme.infoBd },
  neutral: { bg: theme.surfaceSunk, fg: theme.fg2, bd: theme.border },
};

export default function Status1C({ состояние, сбой, onRetry }) {
  if (сбой) {
    return <LoadFailure что="состояние отправки в 1С" onRetry={onRetry} />;
  }
  if (!состояние) {
    return (
      <div
        role="status"
        style={{ font: `400 12px/1.4 ${FONT}`, color: theme.fg3 }}
      >
        Проверяем отправку в 1С…
      </div>
    );
  }
  const строка = строкаСостояния(состояние);
  if (!строка) return null;
  const т = ТОН[строка.тон] || ТОН.neutral;
  return (
    <div
      role="status"
      style={{
        padding: "8px 10px",
        borderRadius: 8,
        background: т.bg,
        border: `1px solid ${т.bd}`,
        color: т.fg,
        font: `500 13px/1.4 ${FONT}`,
      }}
    >
      {строка.текст}
      {строка.доп && (
        <div style={{ font: `400 12px/1.4 ${FONT}`, marginTop: 2 }}>
          {строка.доп}
        </div>
      )}
    </div>
  );
}
