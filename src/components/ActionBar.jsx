import { useContext, useState } from "react";

import { ActionSetter, ActionValue } from "../lib/screenAction";
import { FONT, theme } from "../lib/theme";

// ПОЛОСА ОСНОВНОГО ДЕЙСТВИЯ ЭКРАНА — замена плавающей кнопке (UX-FAB).
//
// ЗАЧЕМ. Круглая кнопка висела НАД списком и закрывала правые 56px той
// карточки, что оказалась в её полосе. Замер 03.08.2026: на «Чеках» под ней
// пряталось 39px СУММЫ из ~81, то есть половина главного числа строки;
// на «Отчётах» — подсказка «Открыть, чтобы просмотреть». Дефект ПЛАВАЮЩИЙ:
// жертва меняется от прокрутки, поэтому он есть на всех ширинах, включая 430,
// и поэтому пережил все починки про ширину — он про СЛОИ, а не про размеры.
//
// Полоса стоит В ПОТОКЕ между списком и нижним меню, а не поверх содержимого:
// список укорачивается сам, перекрывать становится нечем. Замер «как будет»
// @320×568: список 452 → 396px, целых карточек по-прежнему 3 (терялся хвост
// четвёртой, 59% → 14%); порог «меньше двух» наступил бы только при полосе
// выше 200px. Слой не нужен вовсе — соседям по потоку не с чем спорить.
//
// ВИД. Вишнёвый остаётся ЕДИНСТВЕННЫМ CTA экрана: полоса наследует тот же
// акцент, что был у круга, а не добавляет второй. Заливка — у кнопки внутри,
// не у всей полосы: подложка полосы совпадает с нижним меню, чтобы низ экрана
// читался одним блоком, а не двумя полосами разного цвета.
//
// СЛУЧАЙНЫЙ ТАП. Полоса широкая, и палец при прокрутке проходит над ней.
// Так это решают в приложениях с нижней панелью действия, и мы делаем так же:
//   ① кнопка ВСТАВЛЕНА в полосу с отступами 16px по бокам — у краёв экрана,
//      где чаще всего лежит палец, остаётся мёртвая зона;
//   ② браузер сам не отдаёт клик, если касание перешло в прокрутку: на iOS
//      первый тап по инерционно едущему списку её ОСТАНАВЛИВАЕТ и действие
//      не срабатывает. Это и есть основная защита, из-за неё панели такого
//      вида вообще возможны;
//   ③ вертикального запаса нет намеренно: высота цели 56 — решение принято
//      явно (совпадает с прежней кнопкой и с минимумом тапа). Если на
//      устройстве всё же поймаем ложные касания, вставляем кнопку по вертикали
//      на 4-6px, полоса при этом остаётся 56 — цель станет 44-48, что тоже
//      выше минимума.
const H = 56;

export default function ActionBar({ label, Icon, onClick, disabled }) {
  return (
    <div
      style={{
        flexShrink: 0,
        height: H,
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        background: theme.surface,
        borderTop: `1px solid ${theme.border}`,
      }}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        style={{
          width: "100%",
          height: H,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          border: "none",
          borderRadius: 12,
          background: disabled ? theme.fg3 : theme.cherry,
          color: theme.surface,
          font: `600 15px/1 ${FONT}`,
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        {Icon ? <Icon size={20} aria-hidden="true" /> : null}
        {label}
      </button>
    </div>
  );
}

// Провайдер — над всем деревом (main.jsx): потребитель обязан стоять ниже.
export function ScreenActionProvider({ children }) {
  const [action, setAction] = useState(null);
  return (
    <ActionSetter.Provider value={setAction}>
      <ActionValue.Provider value={action}>{children}</ActionValue.Provider>
    </ActionSetter.Provider>
  );
}

// Единственное место отрисовки — в оболочке, над нижним меню. Экран действия
// не объявил («Главная», «Сводка») — полосы нет и высоты она не занимает.
export function ScreenActionSlot() {
  const action = useContext(ActionValue);
  if (!action) return null;
  return <ActionBar {...action} />;
}
