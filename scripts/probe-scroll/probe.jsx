// ⚠️ ЗАМЕР ПОВЕДЕНИЯ ПОИСКА ПРИ ПРОКРУТКЕ. Читать исходник тут нельзя:
// у «держится или уезжает» есть наблюдаемое следствие, владелец его и видит.
import { createRoot } from "react-dom/client";
import { ProfileHub } from "../../src/App.jsx";

const МЕНЯ = {
  id: 1,
  first_name: "Иван",
  last_name: "Петров",
  email: "i@example.com",
  role: "admin",
  is_active: true,
};

createRoot(document.getElementById("root")).render(
  // Оболочка как в приложении: колонка 100dvh, единственный скроллер внутри.
  <div
    style={{
      height: "100dvh",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    }}
  >
    <div style={{ height: 56, flexShrink: 0, background: "#fff" }}>шапка</div>
    <div id="СКРОЛЛЕР" style={{ flex: 1, overflow: "auto" }}>
      <ProfileHub
        role="admin"
        me={МЕНЯ}
        onOpen={() => {}}
        onLogout={() => {}}
      />
    </div>
    <div style={{ height: 56, flexShrink: 0, background: "#fff" }}>меню</div>
  </div>,
);
