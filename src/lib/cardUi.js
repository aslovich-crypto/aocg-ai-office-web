// ⚠️ ОБЩИЕ ЭЛЕМЕНТЫ КАРТОЧЕК ЧЕКА И ОТЧЁТА (1C-29 ③, решение владельца
// 22.09.2026: «карточка отчёта повторяет карточку чека»).
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ. Эти стили жили локальными константами ВНУТРИ функции
// карточки чека — взять их оттуда нельзя: карточка чека сама импортирует
// карточку отчёта, и обратный импорт стал бы циклическим. Переписать рядом
// значило бы завести вторую копию, которая разойдётся с первой молча. Теперь
// обе карточки берут их отсюда, и одинаковыми они остаются по построению.
//
// Значения — только токены ДС. Прежние литералы карточки чека совпадали
// с токенами побайтно (fg1 #111318, successBg #F0FDF4, successFg #15803D) —
// сверено 22.09.2026, вид чека от выноса не меняется.
import { FONT, theme } from "./theme";

// Текстовая кнопка шапки: «‹ Назад».
export const hbtn = {
  display: "flex",
  alignItems: "center",
  gap: 2,
  background: "none",
  border: "none",
  cursor: "pointer",
  color: theme.fg1,
  padding: 8,
  borderRadius: 8,
  font: `400 16px/1 ${FONT}`,
};

// Иконка шапки: «поделиться», «скачать», «⋯».
export const iconBtn = {
  ...hbtn,
  width: 40,
  height: 40,
  justifyContent: "center",
};

// Белая кнопка с рамкой в подвале: «Прикрепить к отчёту», «Отправить в 1С».
export const кнопкаПодвала = {
  width: "100%",
  // Явно, хотя у <button> Chrome и так считает рамку внутри ширины: сторож
  // вёрстки (T14) требует border-box у width:100% — иначе рамка вылезет.
  boxSizing: "border-box",
  height: 50,
  borderRadius: 8,
  border: `1px solid ${theme.borderStrong}`,
  background: theme.surface,
  color: theme.fg1,
  font: `500 15px/1 ${FONT}`,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
};

// ⚠️ КНОПКИ НИЗА КАРТОЧКИ ДОКУМЕНТА (канон 22.09.2026, docs/RULES-FRONTEND.md
// бэкенда, раздел «Карточка документа»): низ = движение документа. Одна
// вишнёвая — действие, переводящее документ в следующее состояние («На
// проверку →», «Отправить в 1С»); рядом белая — только обратный ход.
// Основа общая для всех кнопок низа, вишнёвая — поверх неё.
export const кнопкаНиза = {
  flex: 1,
  // Сторож вёрстки (T14): flex:1 без minWidth:0 не сожмётся уже содержимого.
  minWidth: 0,
  height: 46,
  borderRadius: 8,
  font: `600 15px/1 ${FONT}`,
  cursor: "pointer",
  whiteSpace: "nowrap",
};
export const кнопкаДвижения = {
  ...кнопкаНиза,
  border: "none",
  background: theme.cherry,
  color: theme.surface,
};

// Пилюля-бейдж в шапке карточки: «ФНС» у чека, «1С · документ N» у отчёта.
// Нейтральный тон — пара «Черновика» и НДС-чипа (surfaceSunk / fg2):
// отдельной нейтральной тройки в ДС нет.
const ТОНА = {
  success: { bg: theme.successBg, fg: theme.successFg },
  warning: { bg: theme.warningBg, fg: theme.warningFg },
  info: { bg: theme.infoBg, fg: theme.infoFg },
  neutral: { bg: theme.surfaceSunk, fg: theme.fg2 },
};
export function пилюля(тон) {
  const т = ТОНА[тон] || ТОНА.neutral;
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    border: "none",
    background: т.bg,
    color: т.fg,
    borderRadius: 999,
    padding: "3px 8px",
    font: `500 13px/1 ${FONT}`,
  };
}
