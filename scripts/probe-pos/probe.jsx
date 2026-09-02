// ⚠️ НАСТОЯЩИЙ App с настоящими шапками. Проба probe-vid подсовывала обоим
// экранам одинаковую фиктивную шапку 56px — и «доказала» одинаковость,
// которой на проде может не быть. Здесь меряется ПОЛОЖЕНИЕ поля от верха.
import { createRoot } from "react-dom/client";
import App from "../../src/App.jsx";
const ОТВЕТЫ = {
  "/api/users/me": { id: 1, first_name: "Иван", last_name: "Петров",
    email: "i@example.com", phone: "", role: "admin", is_email_verified: true,
    consent_version: 1, consent_at: "2026-08-01T00:00:00Z", linked_providers: [] },
};
window.fetch = (u) => {
  const путь = String(u).replace(/^https?:\/\/[^/]+/, "").split("?")[0];
  const тело = ОТВЕТЫ[путь] ?? [];
  return Promise.resolve({ ok: true, status: 200,
    json: () => Promise.resolve(тело), text: () => Promise.resolve("[]") });
};
localStorage.setItem("access_token", "проба");
localStorage.setItem("refresh_token", "проба");
localStorage.setItem("consent_given", "true");
localStorage.setItem("consent_version", "1");
createRoot(document.getElementById("root")).render(<App />);
