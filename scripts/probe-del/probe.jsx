// ⚠️ ПРОБА «УДАЛЕНИЕ ОТЧЁТА» (REP-EXPDEL ③): настоящий App против настоящего
// бэкенда стенда. Вход — настоящей регистрацией или входом (пользователя
// уже завёл драйвер самопроверкой, здесь будет 409 и вход).
//
// ⚠️ ОБЁРТКА НАД fetch СЧИТАЕТ УДАЛЕНИЯ, А НЕ ПОДМЕНЯЕТ ОТВЕТЫ. Ответы
// идут от настоящего сервера. Счёт нужен затем, что «строка исчезла»
// и «сервер удалил» — разные утверждения: до этого захода строка
// исчезала ДО запроса, и они расходились молча.
import { createRoot } from "react-dom/client";
import App from "../../src/App.jsx";
import { API } from "../../src/lib/api.js";

const ПОЧТА = "vdel@example.com";
const ПАРОЛЬ = "probe-pass-123";

const настоящий = window.fetch.bind(window);
window.__vdel = { удалений: 0, запросов: 0, отказов429: 0, отказов403: 0 };
window.fetch = async (адрес, опции = {}) => {
  const путь = String(адрес);
  if (/\/api\/reports\/\d+$/.test(путь) && (опции.method || "") === "DELETE")
    window.__vdel.удалений += 1;
  window.__vdel.запросов += 1;
  const ответ = await настоящий(адрес, опции);
  // Отказы ограничителя частоты — отдельным счётом: при них экран честно
  // показывает «не загрузилось», и красный шаг читался бы как дефект
  // карточки, а не как упор стенда в предел.
  if (ответ.status === 429) window.__vdel.отказов429 += 1;
  if (ответ.status === 403) window.__vdel.отказов403 += 1;
  return ответ;
};

async function войти() {
  let r = await настоящий(`${API}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: ПОЧТА,
      password: ПАРОЛЬ,
      first_name: "Проба",
      last_name: "Удаляев",
      org_type: "company",
      org_name: "ООО Проба удаления",
    }),
  });
  if (r.status === 409) {
    r = await настоящий(`${API}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone_or_email: ПОЧТА, password: ПАРОЛЬ }),
    });
  }
  const тело = await r.json().catch(() => null);
  if (!r.ok || !тело?.access_token) {
    document.getElementById("ЗАМЕР").textContent = JSON.stringify({
      НЕ_ОТРИСОВАЛОСЬ: true,
      причина: `вход: код ${r.status} ${JSON.stringify(тело)}`.slice(0, 200),
    });
    return false;
  }
  localStorage.setItem("access_token", тело.access_token);
  localStorage.setItem("refresh_token", тело.refresh_token);
  return true;
}

// Токены, полученные драйвером, — в адресе (a, r): вход один на прогон,
// иначе ограничитель входа отвечает 429 на третьем снимке.
function токеныИзАдреса() {
  const п = new URLSearchParams(location.search);
  if (!п.get("a")) return false;
  localStorage.setItem("access_token", п.get("a"));
  localStorage.setItem("refresh_token", п.get("r") || "");
  return true;
}

(токеныИзАдреса() ? Promise.resolve(true) : войти()).then((готово) => {
  if (готово) createRoot(document.getElementById("root")).render(<App />);
});
