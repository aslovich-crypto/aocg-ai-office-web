import { useEffect, useRef } from "react";

// Доступность модальных диалогов (Modal, BottomSheet и пр.).
// Вид НЕ меняет — работает только с клавиатурой и фокусом:
//  - переносит фокус внутрь диалога при открытии;
//  - возвращает фокус на триггер при закрытии;
//  - закрывает по Escape;
//  - ловит Tab внутри диалога (фокус-ловушка), чтобы фокус не уходил под оверлей.
// Возвращает ref — повесить на корневой контейнер диалога (даём ему tabIndex={-1}).
export function useModalA11y(onClose) {
  const ref = useRef(null);
  // onClose часто пересоздаётся родителем на каждый рендер. Держим его в ref,
  // чтобы основной эффект ниже запускался ОДИН раз на монтирование (deps []),
  // а не перезапускался на каждый рендер (иначе фокус крадётся из полей ввода,
  // слушатель снимается/вешается в цикле, prev.focus() дёргает во время анимации).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    const node = ref.current;
    const prev =
      typeof document !== "undefined" ? document.activeElement : null;

    const focusable = () => {
      if (!node) return [];
      const sel =
        "a[href],button:not([disabled]),input:not([disabled])," +
        "select:not([disabled]),textarea:not([disabled])," +
        '[tabindex]:not([tabindex="-1"])';
      return [...node.querySelectorAll(sel)].filter(
        (el) => el.offsetParent !== null,
      );
    };

    const first = focusable()[0];
    (first || node)?.focus();

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        e.preventDefault();
        node?.focus();
        return;
      }
      const idx = items.indexOf(document.activeElement);
      if (e.shiftKey && idx <= 0) {
        e.preventDefault();
        items[items.length - 1].focus();
      } else if (!e.shiftKey && idx === items.length - 1) {
        e.preventDefault();
        items[0].focus();
      }
    };

    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (prev && typeof prev.focus === "function") prev.focus();
    };
    // Один раз на монтирование: onClose читаем из onCloseRef (см. выше).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return ref;
}
