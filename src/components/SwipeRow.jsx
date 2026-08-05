import { useCallback, useEffect, useRef, useState } from "react";

import { FONT } from "../lib/theme";

// СТРОКА СО СВАЙП-ДЕЙСТВИЯМИ — одна механика на «Чеки» и «Отчёты».
//
// ЗАЧЕМ ОБЩИЙ. Жест не знает ни про статусы отчёта, ни про поля чека:
// ему нужны только список действий и содержимое строки. Раньше он жил
// внутри SwipeableReceiptCard вместе с вёрсткой карточки чека, а на
// «Отчётах» существовал лишь в макете — то есть при первой же попытке
// сделать свайп на втором экране появилась бы вторая реализация. Так уже
// вышло со строкой чека: три копии, три расхождения (UX-ROW).
//
// ОТКУДА ЧИСЛА. Пороги и анимация — из макета
// templates/reports/Отчёты.html (блок `.swipe`), кроме двух мест:
//   • ШИРИНА ДЕЙСТВИЯ 72, а не канонные 84. Канон рисован при ширине
//     макета 402px, где панель из двух кнопок скрывает 45% карточки.
//     На 320 те же 84 скрывают 59% — от карточки остаётся 118px, меньше,
//     чем нужно дате со способом оплаты. Решение владельца продукта.
//   • ОСЬ ЖЕСТА определяется за первые 6px (см. AXIS_LOCK). В макете
//     этого нет, и это не решение дизайна: макет сделан для мыши, у неё
//     нет конфликта с вертикальной прокруткой. На телефоне без разбора
//     оси любой диагональный свайп таскает строку вместо прокрутки.
//
// ЧЕГО КОМПОНЕНТ НЕ ДЕЛАЕТ:
//   • не защищает от двойного тапа по действию — запрос и его состояние
//     знает вызывающий экран; он же гасит действие через `disabled`;
//   • не открывает шторки и не спрашивает подтверждений: по решению
//     05.08 действие срабатывает сразу, а строка закрывается в тот же
//     момент (`settle(false)`), поэтому шторка открывается уже над
//     закрытой строкой.

const ACTION_W = 72; // ширина одного действия
const AXIS_LOCK = 6; // сколько px нужно, чтобы решить: жест по X или по Y
const TAP_SUPPRESS = 4; // сдвинулись больше — тап по строке не считается
const EASE = "transform 240ms cubic-bezier(.32,.72,0,1)";

// Закрытие соседей (как в макете): реестр «закрывашек» всех смонтированных
// строк. Контекст здесь не нужен — поведение общее для всего приложения,
// а не для поддерева, и списки на разных экранах не пересекаются во времени.
const openRows = new Set();

export default function SwipeRow({ actions = [], onTap, children }) {
  const [tx, setTx] = useState(0);
  const [dragging, setDragging] = useState(false); // без перехода, пока палец ведёт
  const startX = useRef(0);
  const startY = useRef(0);
  const active = useRef(false);
  const moved = useRef(false);
  const axis = useRef(null);

  const max = actions.length * ACTION_W;
  const close = useCallback(() => setTx(0), []);

  useEffect(() => {
    openRows.add(close);
    return () => openRows.delete(close);
  }, [close]);

  // Нет действий — нет и жеста: строка ведёт себя как обычная карточка.
  // Так выглядит статус «Одобрен» на «Отчётах» (решение 05.08: «Открыть»
  // осталось тапом и в свайп не выносится).
  const swipeable = actions.length > 0;

  function onPointerDown(e) {
    if (!swipeable) return;
    active.current = true;
    moved.current = false;
    axis.current = null;
    startX.current = e.clientX;
    startY.current = e.clientY;
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e) {
    if (!active.current) return;
    const dx = e.clientX - startX.current;
    const dy = e.clientY - startY.current;
    if (axis.current === null) {
      if (Math.abs(dx) > AXIS_LOCK || Math.abs(dy) > AXIS_LOCK) {
        axis.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      } else return;
    }
    if (axis.current !== "x") return; // вертикаль отдана прокрутке
    if (Math.abs(dx) > TAP_SUPPRESS) moved.current = true;
    const base = tx < 0 ? -max : 0;
    setTx(Math.min(0, Math.max(-max, base + dx)));
  }

  function onPointerUp() {
    if (!active.current) return;
    active.current = false;
    setDragging(false);
    if (axis.current !== "x") return;
    const willOpen = tx < -max / 2; // порог фиксации — половина панели
    if (willOpen) {
      for (const c of openRows) if (c !== close) c(); // закрыть соседей
      setTx(-max);
    } else setTx(0);
  }

  function handleTap() {
    if (moved.current) return; // это был жест, а не тап
    if (tx < 0) {
      close(); // тап по раскрытой строке закрывает её
      return;
    }
    onTap?.();
  }

  return (
    <div style={{ position: "relative", borderRadius: 12, overflow: "hidden" }}>
      {swipeable && (
        <div
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            zIndex: 0,
          }}
        >
          {actions.map((a) => {
            const Icon = a.Icon;
            return (
              <button
                key={a.key || a.label}
                type="button"
                aria-label={a.label}
                disabled={a.disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  close(); // строка закрывается сразу, до самого действия
                  a.onPress?.();
                }}
                style={{
                  width: ACTION_W,
                  border: "none",
                  padding: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 5,
                  background: a.bg,
                  color: "#fff",
                  cursor: a.disabled ? "default" : "pointer",
                  opacity: a.disabled ? 0.6 : 1,
                  // Шрифт задаём ЯВНО. Сокращённая запись `font:` требует
                  // семейство, и `inherit` в ней недопустим — вся строка
                  // отбрасывается молча, подпись рисуется системным шрифтом.
                  // Ни линтер, ни сторож токенов такого не видят.
                  font: `600 12px/1.1 ${FONT}`,
                }}
              >
                {Icon ? <Icon size={20} aria-hidden="true" /> : null}
                {a.label}
              </button>
            );
          })}
        </div>
      )}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={handleTap}
        style={{
          position: "relative",
          zIndex: 1,
          transform: `translateX(${tx}px)`,
          transition: dragging ? "none" : EASE,
          touchAction: "pan-y",
          userSelect: "none",
          cursor: "pointer",
        }}
      >
        {children}
      </div>
    </div>
  );
}
