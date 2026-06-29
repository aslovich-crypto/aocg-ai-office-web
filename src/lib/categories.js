// Резолв категории/группы чека и пастельные цвета групп. Вынесено из App.jsx.
// ARTICLE_GROUP / CAT_BY_ID — модульные синглтоны, заполняются setCatalogMaps()
// при загрузке каталога; все потребители (App, ReceiptDetailModal, CategorySheet)
// импортируют из одного модуля и читают одно и то же состояние.

// D1: цвет статьи определяется её ГРУППОЙ (11 групп справочника). Пастельные bg/fg
// в гармонии с брендовым #A4161A + Cool Neutrals. Семантика: транспорт синий,
// питание янтарный, IT фиолетовый, налоги стальной, представительские — вишнёвые.
export const GROUP_COLORS = {
  "Материалы и расходники": { bg: "#ECFDF5", fg: "#047857" },
  "Питание и кейтеринг": { bg: "#FFFBEB", fg: "#B45309" },
  Командировки: { bg: "#ECFEFF", fg: "#0E7490" },
  Представительские: { bg: "#FDF2F2", fg: "#A4161A" },
  "Офис и помещения": { bg: "#F7FEE7", fg: "#4D7C0F" },
  Связь: { bg: "#EEF2FF", fg: "#4338CA" },
  "IT и софт": { bg: "#F5F3FF", fg: "#6D28D9" },
  Транспорт: { bg: "#EFF6FF", fg: "#1D4ED8" },
  "Реклама и маркетинг": { bg: "#FDF4FF", fg: "#A21CAF" },
  "Профессиональные услуги": { bg: "#FFF7ED", fg: "#C2410C" },
  "Прочее и налоги": { bg: "#F1F5F9", fg: "#475569" },
};
export const GROUP_FALLBACK = { bg: "#EEF0F4", fg: "#636B7D" }; // старые/неизвестные строки
// article name → group name; category_id → {name, group}. Оба заполняются из
// загруженного каталога (setCatalogMaps). CAT_BY_ID — для резолва категории чека
// по category_id (вариант B: бэк больше не отдаёт строку category).
let ARTICLE_GROUP = {};
let CAT_BY_ID = {};
export function setCatalogMaps(catalog) {
  const m = {},
    byId = {};
  (catalog?.groups || []).forEach((g) =>
    (g.categories || []).forEach((c) => {
      m[c.name] = g.name;
      byId[c.id] = { name: c.name, group: g.name };
    }),
  );
  ARTICLE_GROUP = m;
  CAT_BY_ID = byId;
}
export const groupOf = (name) => ARTICLE_GROUP[name] || null;
export const groupColor = (group) => GROUP_COLORS[group] || GROUP_FALLBACK;
export const catColor = (name) => groupColor(groupOf(name)); // статья → цвет её группы
// Резолв категории чека по category_id (вариант B). Мягкий фолбэк B1: каталог не
// загружен / id не найден → нейтральная заглушка «Без категории» + серый цвет.
export const catName = (r) =>
  CAT_BY_ID[r?.category_id]?.name || "Без категории";
export const catGroupById = (r) => CAT_BY_ID[r?.category_id]?.group || null;
export const catColorById = (r) => groupColor(catGroupById(r));
