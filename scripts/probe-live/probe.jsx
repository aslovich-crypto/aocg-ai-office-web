// ⚠️ БЕЗ ПОДСТАВЫ FETCH. Экран «Пользователи» ходит в НАСТОЯЩИЙ HTTP на том
// же хосте. Прежняя проба подставляла ответы — и пропустила белый экран.
import { createRoot } from "react-dom/client";
import { NastroykiPage } from "../../src/App.jsx";

localStorage.setItem("access_token", "test-token");
localStorage.setItem("refresh_token", "test-token");
localStorage.setItem("consent_given", "true");
localStorage.setItem("consent_version", "1");

const МЕНЯ = {
  id: 1,
  first_name: "Иван",
  last_name: "Петров",
  email: "i@example.com",
  phone: "",
  role: "admin",
  is_email_verified: true,
};
createRoot(document.getElementById("root")).render(
  <NastroykiPage
    me={МЕНЯ}
    экран="Пользователи"
    наЭкран={() => {}}
    cards={[]}
    onAddCard={() => {}}
    onUpdateCard={() => {}}
    onDeleteCard={() => {}}
    onSetDefaultCard={() => {}}
    users={[
      { ...МЕНЯ, id: 2, first_name: "Живой", last_name: "Сотрудник",
        role: "employee", is_active: true },
      { ...МЕНЯ, id: 3, first_name: "Погашенный", last_name: "Человек",
        role: "employee", is_active: false },
    ]}
    onRestoreUser={() => {}}
    onDeleteUser={() => {}}
    role="admin"
    catalog={{ groups: [] }}
    onCatalogRefresh={() => {}}
  />,
);
