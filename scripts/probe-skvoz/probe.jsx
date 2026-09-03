// ⚠️ СКВОЗНАЯ ПРОБА (T135). НИ ОДНОГО СТАБА: fetch настоящий, на том конце —
// настоящий FastAPI с настоящим PostgreSQL, который поднял драйвер
// (scripts/check-skvoznoy.mjs). Всё, что делает эта проба, доезжает до базы.
//
// ⚠️ ЧЕМ ОТЛИЧАЕТСЯ ОТ probe-behaviour: та подставляет ответы объектом
// ОТВЕТЫ — то есть проверяет фронт против ПРЕДСТАВЛЕНИЙ фронта о сервере.
// Расхождение «фронт шлёт не то поле» она пропустит: подставленный ответ
// придёт правильным при любом запросе. Здесь такого класса нет.
//
// ⚠️ ВХОД ГОТОВИТСЯ HTTP-ОМ, А НЕ ЭКРАНОМ, И ЭТО НАЗВАНО ЧЕСТНО. Форма
// регистрации — отдельный многошаговый экран с согласием; гнать его здесь
// значит смешать две проверки в одной и получить красный, по которому
// неясно, что сломалось. Регистрация идёт настоящим запросом на настоящий
// сервер (строка в users появляется в базе, драйвер это сверяет), а дальше
// ВСЁ через экран: чек и отчёт заводятся кнопками.
import { createRoot } from "react-dom/client";
import App from "../../src/App.jsx";
import { API } from "../../src/lib/api.js";

const ПОЧТА = "skvoz@example.com";
const ПАРОЛЬ = "probe-pass-123";

async function войти() {
  let r = await fetch(`${API}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: ПОЧТА,
      password: ПАРОЛЬ,
      first_name: "Сквозной",
      last_name: "Проверяющий",
      org_type: "company",
      org_name: "ООО Сквозная",
    }),
  });
  // ⚠️ ПОВТОРНЫЙ ПРОГОН — ОБЫЧНОЕ ДЕЛО: замер переснимается до трёх раз,
  // база при этом одна на прогон. Второй регистрации не бывает (409) —
  // значит входим. Без этого прибор ронял сам себя на своей же второй
  // попытке и печатал «регистрация: код 409» вместо шагов сценария.
  if (r.status === 409) {
    r = await fetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone_or_email: ПОЧТА, password: ПАРОЛЬ }),
    });
  }
  const тело = await r.json().catch(() => null);
  if (!r.ok || !тело?.access_token) {
    // Замер не состоялся — так и говорим, вместо того чтобы идти сценарием
    // по неавторизованному приложению и красить все шаги разом (T89).
    document.getElementById("ЗАМЕР").textContent = JSON.stringify({
      НЕ_ОТРИСОВАЛОСЬ: true,
      причина: `регистрация: код ${r.status} ${JSON.stringify(тело)}`.slice(
        0,
        200,
      ),
    });
    return false;
  }
  localStorage.setItem("access_token", тело.access_token);
  localStorage.setItem("refresh_token", тело.refresh_token);
  localStorage.setItem("consent_given", "true");
  localStorage.setItem("consent_version", "1");
  return true;
}

войти().then((готово) => {
  if (готово) createRoot(document.getElementById("root")).render(<App />);
});
