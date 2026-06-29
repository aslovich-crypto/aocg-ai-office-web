// Канонические токены палитры и шрифта (зеркало colors_and_type.css дизайн-системы).
// Вынесено из App.jsx, чтобы переиспользовать в выделяемых компонентах
// (ReceiptDetailModal, CategorySheet и далее по ходу дробления монолита).
export const C = {
  cherry: "#A4161A",
  cherryD: "#7a1014",
  cherryL: "#F2E0E0",
  cherryM: "#D4888A",
  dark: "#161A1D", // mark field / neutral-900 (text uses #111318)
  mid: "#404040",
  gray: "#636B7D", // secondary text / labels (cool)
  grayL: "#9CA3AF", // tertiary / placeholder
  silver: "#EEF0F4", // hairline borders & dividers (cool)
  lightGray: "#EEF0F4", // sunk fills — search field, table headers, chips (cool)
  light: "#F6F7F9", // default page background (cool)
  borderD: "#E2E5EB", // in-card divider, one step darker than --border
  white: "#ffffff",
};

export const FONT =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
