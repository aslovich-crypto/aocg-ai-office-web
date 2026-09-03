// ⚠️ ПРОБА ПРОТУХШЕГО ТОКЕНА (T152). Вопрос владельца дословно: «сотрудник
// откроет утром, вернётся после обеда — никто не знает, что он увидит».
// Механизм тихого обновления написан (authFetch → 401 → tryRefresh → повтор),
// но ни одна проба не ждала дольше пары секунд: путь «протух → обновился →
// продолжил работать» не проходили НИ РАЗУ.
//
// ⚠️ ЧАС ЖДАТЬ НЕ НУЖНО: протухший access выпускает драйвер тем же секретом,
// что и живой сервер (exp в прошлом), и передаёт сюда в адресе. Сервер такой
// токен отвергает по-настоящему — подделки в проверке нет.
//
// РЕЖИМЫ (?rezhim=): protuh — протух только access (живой refresh);
// oba — протухли ОБА; gonka — протух access и два запроса уходят разом.
import { createRoot } from "react-dom/client";
import App from "../../src/App.jsx";
import { API, authFetch } from "../../src/lib/api.js";

const ПОЧТА = "token@example.com";
const ПАРОЛЬ = "probe-pass-123";
const параметры = new URLSearchParams(location.search);
const РЕЖИМ = параметры.get("rezhim") || "protuh";
const ПРОТУХШИЙ = параметры.get("stale") || "";

function сдаться(причина) {
  document.getElementById("ЗАМЕР").textContent = JSON.stringify({
    НЕ_ОТРИСОВАЛОСЬ: true,
    причина: String(причина).slice(0, 200),
  });
}

async function подготовить() {
  let r = await fetch(`${API}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: ПОЧТА,
      password: ПАРОЛЬ,
      first_name: "Токеновый",
      last_name: "Проверяющий",
      org_type: "company",
      org_name: "ООО Токен",
    }),
  });
  // Повторный прогон — обычное дело: замер переснимается до трёх раз,
  // а база одна на прогон. Второй регистрации не бывает (409) — входим.
  if (r.status === 409) {
    r = await fetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone_or_email: ПОЧТА, password: ПАРОЛЬ }),
    });
  }
  const тело = await r.json().catch(() => null);
  if (!r.ok || !тело?.access_token) {
    сдаться(`вход: код ${r.status} ${JSON.stringify(тело)}`);
    return null;
  }

  // Согласие даём запросом, а не экраном: этот экран уже проходит сквозная
  // проба (T135), и повторять его здесь значит мерить дважды одно и то же.
  // Тело намеренно пустое: субъекта определяет ТОКЕН, адрес — сервер
  // (app/routers/consent.py, ConsentRequest).
  await fetch(`${API}/api/consent/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${тело.access_token}`,
    },
    body: "{}",
  }).catch(() => {});

  // ⚠️ КОГДА ПОДСОВЫВАТЬ ПРОТУХШИЙ ТОКЕН — РАЗНЫЕ ВОПРОСЫ.
  // Режим «oba» — про запуск с мёртвой сессией, там протухшее лежит сразу.
  // Режимы «protuh»/«gonka» — про «ушёл на обед С ОТКРЫТЫМ ЭКРАНОМ»:
  // приложение поднимается на ЖИВОМ токене, а протухает уже в работе.
  // Иначе меряется старт, а не работа, и сохранность ввода проверять негде.
  localStorage.setItem(
    "access_token",
    РЕЖИМ === "oba" ? ПРОТУХШИЙ : тело.access_token,
  );
  localStorage.setItem(
    "refresh_token",
    РЕЖИМ === "oba" ? ПРОТУХШИЙ : тело.refresh_token,
  );
  // Ручки для сценария: «уйти на обед» и сделать НАСТОЯЩИЙ запрос
  // приложения — тем самым authFetch, что и все экраны.
  window.__уйтиНаОбед = () => {
    localStorage.setItem("access_token", ПРОТУХШИЙ);
    window.__обновлений = 0;
  };
  window.__запрос = async () => {
    try {
      const r = await authFetch("/api/receipts/");
      window.__ответ = r.status;
    } catch (е) {
      window.__ответ = String(е).slice(0, 40);
    }
  };
  localStorage.setItem("consent_given", "true");
  localStorage.setItem("consent_version", "1");
  return тело;
}

// ⚠️ СЧИТАЕМ ОБНОВЛЕНИЯ. Пункт ② строки: два запроса ловят 401 одновременно —
// обновление не должно задваиваться. Наблюдать это можно только счётчиком
// настоящих запросов к /api/auth/refresh, поэтому оборачиваем fetch.
window.__обновлений = 0;
const исходныйFetch = window.fetch.bind(window);
window.fetch = (u, o) => {
  if (String(u).indexOf("/api/auth/refresh") >= 0) window.__обновлений++;
  return исходныйFetch(u, o);
};

подготовить().then((готово) => {
  if (готово) createRoot(document.getElementById("root")).render(<App />);
});
