// Сетевой слой: адрес бэкенда, хранилище токенов и authFetch с обновлением
// access-токена по 401. Вынесено из App.jsx (предписано CLAUDE.md): компоненты
// вне монолита не должны получать authFetch пропсом или дублировать его.
// React-состояния тут нет — только localStorage и fetch, поэтому модуль
// импортируется откуда угодно, включая зону Финансов.

// ?? , а не || — намеренно (T20). Пути ниже строятся как `API + "/api/…"`,
// поэтому для локального прогона через прокси Vite нужен ПУСТОЙ префикс:
// тогда запрос уходит на /api/auth/login того же происхождения, и прокси
// отправляет его на бэкенд. С `||` пустая строка считалась бы «не задано»
// и молча подставлялся бы боевой адрес — то есть сборка выглядела бы
// настроенной, а ходила мимо прокси. Значение "/api" здесь НЕ годится:
// получилось бы /api/api/auth/login.
export const API = import.meta.env.VITE_API_URL ?? "https://api.aocgai.ru";

// fetch with an abort-based ceiling. The receipt scanner awaits several
// backend calls (FNS check, payment suggestion, OCR) while showing a blocking
// spinner; any of them stalling would freeze the modal forever, so every one
// of them goes through here. On timeout the request is aborted and the throw
// propagates to the caller's catch (which treats it as a partial result).
export function fetchWithTimeout(url, opts = {}, ms = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() =>
    clearTimeout(timer),
  );
}

// ─── AUTH: token storage + authed fetch (refresh on 401) ───
export const tokens = {
  get access() {
    try {
      return localStorage.getItem("access_token");
    } catch {
      return null;
    }
  },
  get refresh() {
    try {
      return localStorage.getItem("refresh_token");
    } catch {
      return null;
    }
  },
  set({ access_token, refresh_token }) {
    try {
      if (access_token) localStorage.setItem("access_token", access_token);
      if (refresh_token) localStorage.setItem("refresh_token", refresh_token);
    } catch {
      /* storage unavailable */
    }
  },
  clear() {
    try {
      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");
    } catch {
      /* ignore */
    }
  },
};

// ⚠️ ОДНО ОБНОВЛЕНИЕ НА ВСЕХ, И ЭТО НАЙДЕНО ПРИБОРОМ, А НЕ ПРИДУМАНО.
// Проба протухшего токена (npm run token, T152) замерила 04.09.2026:
// приложение, поднятое с протухшим access, слало СЕМЬ запросов на
// /api/auth/refresh — по одному на каждый стартовый запрос экрана; два
// параллельных действия давали два обновления. Каждый экран честно ловил
// свой 401 и честно шёл обновляться, не зная о соседях.
// Здесь общий незавершённый промис: первый пришедший обновляет, остальные
// ЖДУТ ЕГО и получают тот же ответ. Обнуляем в finally — иначе следующее
// протухание (через час) пришлось бы на уже отработавший промис.
let идётОбновление = null;

export async function tryRefresh() {
  if (идётОбновление) return идётОбновление;
  идётОбновление = _обновитьТокен().finally(() => {
    идётОбновление = null;
  });
  return идётОбновление;
}

async function _обновитьТокен() {
  const rt = tokens.refresh;
  if (!rt) return false;
  try {
    const r = await fetch(API + "/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: rt }),
    });
    if (!r.ok) return false;
    const d = await r.json().catch(() => null);
    if (d && d.access_token) {
      tokens.set({ access_token: d.access_token });
      return true;
    }
  } catch {
    /* network */
  }
  return false;
}

export async function authFetch(path, opts = {}, ms = 15000, _retry = true) {
  const url = path.startsWith("http") ? path : `${API}${path}`;
  const headers = { ...(opts.headers || {}) };
  const tok = tokens.access;
  if (tok) headers["Authorization"] = `Bearer ${tok}`;
  const res = await fetchWithTimeout(url, { ...opts, headers }, ms);
  if (res.status === 401 && _retry) {
    if (await tryRefresh()) return authFetch(path, opts, ms, false);
    tokens.clear();
    try {
      window.dispatchEvent(new Event("auth:logout"));
    } catch {
      /* ignore */
    }
  }
  return res;
}

// ⚠️ ЛЮБОЕ ТЕЛО ОТКАЗА — В СТРОКУ, И ЭТО НЕ УДОБСТВО, А ЗАЩИТА ОТ БЕЛОГО
// ЭКРАНА. Блокер 31.08.2026: форма приглашения клала `тело.detail` прямо
// в состояние и рисовала его. У FastAPI при несходстве типов `detail` —
// МАССИВ ОБЪЕКТОВ (`{type, loc, msg, input}`), а React на объект в детях
// БРОСАЕТ (ошибка №31) — то есть отказ сервера уносил приложение целиком.
// Замер: воспроизведено против настоящего сервера, кадры сошлись со стеком
// с телефона владельца до смещения в бандле.
//
// ⚠️ ПОЧЕМУ НЕ `JSON.stringify`: человеку нужен текст, а не разметка. Из
// массива берём `msg` — это и есть человеческая половина ответа FastAPI.
export function текстОшибки(тело, запасной = "Не удалось выполнить запрос") {
  if (!тело) return запасной;
  if (typeof тело === "string") return тело || запасной;
  const d = тело.detail !== undefined ? тело.detail : тело.message;
  if (typeof d === "string" && d) return d;
  if (Array.isArray(d)) {
    const строки = d
      .map((э) => (э && typeof э === "object" ? э.msg || э.detail : э))
      .filter((э) => typeof э === "string" && э);
    if (строки.length) return строки.join(". ");
  }
  if (d && typeof d === "object" && typeof d.msg === "string") return d.msg;
  return запасной;
}
