// Форматтеры дат и нормализация названия организации. Вынесено из App.jsx
// для переиспользования в выделяемых компонентах. Чистые функции, без состояния.

export const fmtDate = (s) => {
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

export const fmtDateTime = (ts) => {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const ORG_FULL_FORMS = [
  [/публичное\s+акционерное\s+общество/i, "ПАО"],
  [/закрытое\s+акционерное\s+общество/i, "ЗАО"],
  [/открытое\s+акционерное\s+общество/i, "ОАО"],
  [/общество\s+с\s+ограниченной\s+ответственностью/i, "ООО"],
  [/акционерное\s+общество/i, "АО"],
  [/индивидуальный\s+предприниматель/i, "ИП"],
  // Anchored: "И П Иванов" / "И. П. Иванов" / "И.П. Иванов" at the very start
  // collapse to "ИП". The trailing-space lookahead prevents matching inside
  // an org name that happens to contain those letters.
  [/^(\s*)И\s*\.?\s*П\s*\.?(?=\s)/i, "$1ИП"],
];

export function shortOrg(org) {
  if (!org) return org;
  let s = String(org);
  for (const [re, abbr] of ORG_FULL_FORMS) {
    if (re.test(s)) {
      s = s.replace(re, abbr);
      break;
    }
  }
  return s.replace(/\s+/g, " ").trim();
}

// Способ оплаты в КОМПАКТНОМ списке — только последние четыре цифры карты.
// Так в макете (`templates/receipts/Чеки.html`: иконка карты + «3950»);
// имя карты там не показывают вовсе, оно остаётся в деталях чека.
//
// ОТКУДА ЦИФРЫ — порядок выведен из данных прода, а не из схемы:
//  1. receipts.card_last4 — её заполняют парсеры ФНС и OCR, когда номер виден
//     в самом чеке. НА 05.08.2026 ОНА ПУСТА У ВСЕХ 30 ЧЕКОВ: карта приходит
//     из справочника организации, а не из чека. Проверяем первой всё равно —
//     это единственный источник, где цифры взяты из документа;
//  2. хвост из четырёх цифр в имени карты («Корпоративная 3950»,
//     «Личная 6645») — покрытие 29 из 29 на момент замера;
//  3. цифр нет вовсе («Наличные», «Не указано», карта без номера в имени) —
//     возвращаем НАЗВАНИЕ: короткие значения влезают целиком, а пустое место
//     хуже огрызка.
export function paymentShort(r) {
  const fromColumn = String(r?.card_last4 || "").match(/\d{4}/);
  const fromName = String(r?.payment || "").match(/(\d{4})\s*$/);
  const digits = fromColumn ? fromColumn[0] : fromName ? fromName[1] : null;
  return digits || r?.payment || "—";
}

// Наличные рисуются другой иконкой (Banknote), карты — CreditCard.
// Признак берём по тексту способа оплаты: отдельного поля у нас нет.
export const isCash = (r) => /налич/i.test(String(r?.payment || ""));
