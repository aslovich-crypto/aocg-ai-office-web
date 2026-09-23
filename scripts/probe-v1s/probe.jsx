// ⚠️ ПРОБА «ОТПРАВКА В 1С» (1C-29 ②б): настоящий App против настоящего
// бэкенда стенда. Вход — настоящей регистрацией или входом (пользователя
// уже завёл драйвер самопроверкой, здесь будет 409 и вход).
//
// ⚠️ СЧЁТЧИК ЗАПРОСОВ — ОБЁРТКА, А НЕ ПОДМЕНА. Ответы идут от настоящего
// сервера без изменений; обёртка только считает, сколько раз карточка
// спросила состояние отправки. Так проверяется «после любого исхода —
// перечитать» (T156): второй запрос обязан уйти, иначе экран живёт старым.
import { createRoot } from "react-dom/client";
import App from "../../src/App.jsx";
import { API } from "../../src/lib/api.js";

const ПОЧТА = "v1s@example.com";
const ПАРОЛЬ = "probe-pass-123";

const настоящий = window.fetch.bind(window);
window.__v1s = { состояние: 0, запросов: 0, отказов429: 0, отказов403: 0 };
window.fetch = async (адрес, опции = {}) => {
  const путь = String(адрес);
  if (путь.includes("/export-state") && !(опции.method || "").trim())
    window.__v1s.состояние += 1;
  window.__v1s.запросов += 1;
  const ответ = await настоящий(адрес, опции);
  // Отказы ограничителя частоты — отдельным счётом: при них экран честно
  // показывает «не загрузилось», и красный шаг читался бы как дефект
  // карточки, а не как упор стенда в предел.
  if (ответ.status === 429) window.__v1s.отказов429 += 1;
  if (ответ.status === 403) window.__v1s.отказов403 += 1;
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
      last_name: "Однаэс",
      org_type: "company",
      org_name: "ООО Проба 1С",
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

// Замер без оценки: что ручка списка говорит про 1С у нашего отчёта.
async function спроситьСписок() {
  try {
    const о = await настоящий(`${API}/api/reports/`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem("access_token")}`,
      },
    });
    const тело = await о.json();
    const наш = тело.find((р) => р.title === "Отчёт для 1С");
    window.__in1c = наш
      ? `in_1c=${наш.in_1c} поля=${Object.keys(наш).length}`
      : "отчёта нет";
  } catch (е) {
    window.__in1c = `ошибка: ${е}`;
  }
}

(токеныИзАдреса() ? Promise.resolve(true) : войти()).then((готово) => {
  спроситьСписок();
  if (готово) createRoot(document.getElementById("root")).render(<App />);
});
