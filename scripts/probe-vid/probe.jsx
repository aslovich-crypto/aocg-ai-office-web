// ⚠️ ЗАМЕР ОТРИСОВКОЙ, А НЕ ПО CSS. Владелец видит ПОЛОСУ целиком,
// я мерил поле — и назвал вывод. Здесь меряются оба числа явно.
import { createRoot } from "react-dom/client";
import { ProfileHub } from "../../src/App.jsx";
import GlavnayaPage from "../../src/pages/GlavnayaPage.jsx";

const МЕНЯ = {
  id: 1,
  first_name: "Иван",
  last_name: "Петров",
  email: "i@example.com",
  role: "admin",
  is_active: true,
};
const чеки = [
  {
    id: 1,
    org: "ООО Ромашка",
    amount: 1200,
    date: "2026-08-30",
    payment: "Карта",
  },
];
const пусто = () => {};
const заглушка = {
  receipts: чеки,
  catalog: { groups: [] },
  org: { tax_system: "usn_d_r" },
  setPage: пусто,
  authFetch: () =>
    Promise.resolve({ ok: true, json: () => Promise.resolve([]) }),
  plural: (n, f) => f[0],
  inPeriod: () => true,
  catName: () => "Без категории",
  catColor: () => ({}),
};

createRoot(document.getElementById("root")).render(
  <div>
    <div data-экран="Профиль" style={{ width: 390, background: "#F6F7F9" }}>
      <div style={{ height: 56, background: "#fff" }}>шапка</div>
      <ProfileHub role="admin" me={МЕНЯ} onOpen={пусто} onLogout={пусто} />
    </div>
    <div data-экран="Главная" style={{ width: 390, background: "#F6F7F9" }}>
      <div style={{ height: 56, background: "#fff" }}>шапка</div>
      <GlavnayaPage {...заглушка} />
    </div>
  </div>,
);
