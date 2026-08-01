// Сетевой слой: адрес бэкенда, хранилище токенов и authFetch с обновлением
// access-токена по 401. Вынесено из App.jsx (предписано CLAUDE.md): компоненты
// вне монолита не должны получать authFetch пропсом или дублировать его.
// React-состояния тут нет — только localStorage и fetch, поэтому модуль
// импортируется откуда угодно, включая зону Финансов.

export const API =
  import.meta.env.VITE_API_URL ||
  "https://aocg-ai-office-production.up.railway.app";

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

export async function tryRefresh() {
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
