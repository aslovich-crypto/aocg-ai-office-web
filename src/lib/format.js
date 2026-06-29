// Форматтеры дат и нормализация названия организации. Вынесено из App.jsx
// для переиспользования в выделяемых компонентах. Чистые функции, без состояния.

export const fmtDate = (s) =>
  new Date(s).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

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
