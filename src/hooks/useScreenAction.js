import { useContext, useEffect, useRef } from "react";

import { ActionSetter } from "../lib/screenAction";

// ЭКРАН ОБЪЯВЛЯЕТ СВОЁ ДЕЙСТВИЕ, А НЕ РИСУЕТ КНОПКУ:
//
//   useScreenAction({ label: "Новый отчёт", Icon: Plus, onClick: openCreate });
//
// Рисует оболочка — полосой над нижним меню (ScreenActionSlot). Почему не
// карта действий в оболочке: новому экрану пришлось бы ПОМНИТЬ про строку
// в карте, а забыть проще, чем нарисовать свою кнопку рядом — так и появляется
// третья копия (см. UX-ROW, где копий строки чека уже три). Здесь копию
// поставить некуда: место отрисовки одно, попасть в него можно только вызовом
// хука. Вторая причина — обработчик остаётся там, где живёт его состояние,
// и инфраструктура не тянет логику экрана вверх.
export function useScreenAction({ label, Icon, onClick, disabled } = {}) {
  const setAction = useContext(ActionSetter);
  // Обработчик — через ref: он новый на каждый рендер, и попади он
  // в зависимости эффекта, объявление шло бы по кругу. Присваивание внутри
  // эффекта, а не в теле: правка ref во время рендера запрещена (react-hooks).
  const cb = useRef(onClick);
  useEffect(() => {
    cb.current = onClick;
  });
  useEffect(() => {
    if (!label) return undefined;
    setAction({
      label,
      Icon,
      disabled,
      onClick: (...a) => cb.current && cb.current(...a),
    });
    return () => setAction(null);
  }, [setAction, label, Icon, disabled]);
}
