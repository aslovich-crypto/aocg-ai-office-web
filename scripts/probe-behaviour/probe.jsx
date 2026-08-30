// ⚠️ ПРОБА ЖИВОГО ПРИЛОЖЕНИЯ, а не отдельных компонентов. Нужна, чтобы
// проверять ПОВЕДЕНИЕ: нажали «Выйти» → вошли → куда попали. Сторож,
// читающий исходник, отвечает лишь «проводка написана», и на возврате
// после выхода он был зелёным при неработающем поведении.
import { createRoot } from "react-dom/client";
import App from "../../src/App.jsx";

const ОТВЕТЫ = {
  "/api/users/me": {
    id: 1,
    first_name: "Иван",
    last_name: "Петров",
    email: "i@example.com",
    phone: "",
    role: "admin",
    is_email_verified: true,
    consent_version: 1,
    consent_at: "2026-08-01T00:00:00Z",
    linked_providers: [],
  },
  "/api/auth/login": { access_token: "проба", refresh_token: "проба" },
};
// ⚠️ РЕЖИМ ОТКАЗА. Без него поведение при 403 проверить нечем: учётки
// отключённого сотрудника у владельца нет, и глазами это не увидит
// никто. ?otkaz=disabled — вход отвечает 403 с account_disabled.
const ОТКАЗ = new URLSearchParams(location.search).get("otkaz");

window.fetch = (u) => {
  const путь = String(u)
    .replace(/^https?:\/\/[^/]+/, "")
    .split("?")[0];
  if (ОТКАЗ === "disabled" && путь === "/api/auth/login") {
    const отказ = {
      detail:
        "Учётная запись отключена. Обратитесь к администратору организации",
      code: "account_disabled",
    };
    return Promise.resolve({
      ok: false,
      status: 403,
      json: () => Promise.resolve(отказ),
      text: () => Promise.resolve(JSON.stringify(отказ)),
    });
  }
  const тело = ОТВЕТЫ[путь] ?? [];
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(тело),
    text: () => Promise.resolve(JSON.stringify(тело)),
  });
};
localStorage.setItem("access_token", "проба");
localStorage.setItem("refresh_token", "проба");
localStorage.setItem("consent_given", "true");
localStorage.setItem("consent_version", "1");

createRoot(document.getElementById("root")).render(<App />);
