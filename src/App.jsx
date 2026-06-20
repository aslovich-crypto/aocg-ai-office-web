/* global __BUILD_TIME__ */
import { useState, useEffect, useRef, useCallback } from "react";
import { useModalA11y } from "./hooks/useModalA11y";
import OrganizationTab from "./pages/OrganizationTab";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { Html5Qrcode, Html5QrcodeScannerState } from "html5-qrcode";
import jsQR from "jsqr";
import {
  Camera,
  ImageUp,
  PenLine,
  ChartColumn,
  ClipboardList,
  Settings,
  ReceiptText,
  Eye,
  EyeOff,
  Mail,
  AlertTriangle,
  Lock,
  Trash2,
  User,
  Bell,
  ChevronDown,
  Check,
  Share2,
  Plus,
  Flashlight,
  FileText,
} from "lucide-react";
import { snapdom } from "@zumer/snapdom";

const API =
  import.meta.env.VITE_API_URL ||
  "https://aocg-ai-office-production.up.railway.app";

// fetch with an abort-based ceiling. The receipt scanner awaits several
// backend calls (FNS check, payment suggestion, OCR) while showing a blocking
// spinner; any of them stalling would freeze the modal forever, so every one
// of them goes through here. On timeout the request is aborted and the throw
// propagates to the caller's catch (which treats it as a partial result).
function fetchWithTimeout(url, opts = {}, ms = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() =>
    clearTimeout(timer),
  );
}

// ─── AUTH: token storage + authed fetch (refresh on 401) ───
const tokens = {
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

async function tryRefresh() {
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

// Authed API call. Prepends the API base for "/..." paths, attaches the bearer
// token, and on 401 tries one refresh+retry; if that fails the session is
// cleared and an "auth:logout" event tells the app to drop to the login screen.
async function authFetch(path, opts = {}, ms = 15000, _retry = true) {
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

// Sign out: revoke the refresh token server-side, clear local tokens, drop to login.
async function logout() {
  const rt = tokens.refresh;
  try {
    await fetch(API + "/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: rt }),
    });
  } catch {
    /* offline — clear locally anyway */
  }
  tokens.clear();
  try {
    window.dispatchEvent(new Event("auth:logout"));
  } catch {
    /* ignore */
  }
}

const C = {
  cherry: "#A4161A",
  cherryD: "#7a1014",
  cherryL: "#F2E0E0",
  cherryM: "#D4888A",
  dark: "#161A1D", // mark field / neutral-900 (text uses #111318)
  mid: "#404040",
  gray: "#636B7D", // secondary text / labels (cool)
  grayL: "#9CA3AF", // tertiary / placeholder
  silver: "#EEF0F4", // hairline borders & dividers (cool)
  lightGray: "#EEF0F4", // sunk fills — search field, table headers, chips (cool)
  light: "#F6F7F9", // default page background (cool)
  borderD: "#E2E5EB", // in-card divider, one step darker than --border
  white: "#ffffff",
};

const FONT =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
// D2: 9 видов расхода в налоговом учёте — зеркало CHECK-констрейнта categories.tax_kind на бэке.
const TAX_KINDS = [
  "Материальные расходы",
  "Прочие расходы",
  "Командировочные расходы",
  "Представительские расходы",
  "Расходы на рекламу (нормируемые)",
  "Транспортные расходы",
  "Оплата труда",
  "Налоги и сборы",
  "Не учитываемые в целях налогообложения",
];

const ROLES = [
  {
    id: "admin",
    label: "Администратор",
    desc: "Заводит кабинет компании, регистрирует сотрудников, управляет лицензией.",
  },
  {
    id: "employee",
    label: "Сотрудник",
    desc: "Добавляет первичные документы, создаёт отчёты и отправляет на проверку.",
  },
  {
    id: "manager",
    label: "Руководитель",
    desc: "Проверяет отчёты: возвращает, одобряет или отклоняет. Смотрит статистику.",
  },
  {
    id: "accountant",
    label: "Бухгалтер",
    desc: "Регистрирует сотрудников, проверяет и выгружает отчёты в 1С.",
  },
];

const fmt = (n) =>
  Number(n).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + " ₽";
const fmtDate = (s) =>
  new Date(s).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
// Русские метки источника чека (как в фильтре «Источник») — для баннера дублей.
const SRC_LABEL = {
  fns: "ФНС",
  qr_scan: "QR",
  photo_ocr: "Фото",
  manual: "Вручную",
};
// Склонение существительного по числу: plural(n, ["чек","чека","чеков"]).
const plural = (n, forms) => {
  const n10 = n % 10,
    n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return forms[0];
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return forms[1];
  return forms[2];
};
const monthLabel = (s) =>
  new Date(s)
    .toLocaleDateString("ru-RU", { month: "long", year: "numeric" })
    .replace(/^./, (c) => c.toUpperCase());

// D1: цвет статьи определяется её ГРУППОЙ (11 групп справочника). Пастельные bg/fg
// в гармонии с брендовым #A4161A + Cool Neutrals. Семантика: транспорт синий,
// питание янтарный, IT фиолетовый, налоги стальной, представительские — вишнёвые.
const GROUP_COLORS = {
  "Материалы и расходники": { bg: "#ECFDF5", fg: "#047857" },
  "Питание и кейтеринг": { bg: "#FFFBEB", fg: "#B45309" },
  Командировки: { bg: "#ECFEFF", fg: "#0E7490" },
  Представительские: { bg: "#FDF2F2", fg: "#A4161A" },
  "Офис и помещения": { bg: "#F7FEE7", fg: "#4D7C0F" },
  Связь: { bg: "#EEF2FF", fg: "#4338CA" },
  "IT и софт": { bg: "#F5F3FF", fg: "#6D28D9" },
  Транспорт: { bg: "#EFF6FF", fg: "#1D4ED8" },
  "Реклама и маркетинг": { bg: "#FDF4FF", fg: "#A21CAF" },
  "Профессиональные услуги": { bg: "#FFF7ED", fg: "#C2410C" },
  "Прочее и налоги": { bg: "#F1F5F9", fg: "#475569" },
};
const GROUP_FALLBACK = { bg: "#EEF0F4", fg: "#636B7D" }; // старые/неизвестные строки
// article name → group name; category_id → {name, group}. Оба заполняются из
// загруженного каталога (setCatalogMaps). CAT_BY_ID — для резолва категории чека
// по category_id (вариант B: бэк больше не отдаёт строку category).
let ARTICLE_GROUP = {};
let CAT_BY_ID = {};
function setCatalogMaps(catalog) {
  const m = {},
    byId = {};
  (catalog?.groups || []).forEach((g) =>
    (g.categories || []).forEach((c) => {
      m[c.name] = g.name;
      byId[c.id] = { name: c.name, group: g.name };
    }),
  );
  ARTICLE_GROUP = m;
  CAT_BY_ID = byId;
}
const groupOf = (name) => ARTICLE_GROUP[name] || null;
const groupColor = (group) => GROUP_COLORS[group] || GROUP_FALLBACK;
const catColor = (name) => groupColor(groupOf(name)); // статья → цвет её группы
// Резолв категории чека по category_id (вариант B). Мягкий фолбэк B1: каталог не
// загружен / id не найден → нейтральная заглушка «Без категории» + серый цвет.
const catName = (r) => CAT_BY_ID[r?.category_id]?.name || "Без категории";
const catGroupById = (r) => CAT_BY_ID[r?.category_id]?.group || null;
const catColorById = (r) => groupColor(catGroupById(r));

// Prefix forms we strip when picking the avatar initial. The `И\s*\.?\s*П\s*\.?`
// alternative handles separated variants ("И П Иванов", "И. П. Иванов", "И.П.
// Иванов") in addition to the joined "ИП Иванов".
const ORG_PREFIX_RE =
  /^\s*(ООО|ОАО|АО|ИП|ЗАО|ПАО|ПК|И\s*\.?\s*П\s*\.?|ИНДИВИДУАЛЬНЫЙ\s+ПРЕДПРИНИМАТЕЛЬ)\s+/i;
const QUOTE_RE = /^["«»'«»“”„]+/;
function orgInitial(org) {
  if (!org) return "?";
  let s = String(org).trim();
  while (ORG_PREFIX_RE.test(s)) s = s.replace(ORG_PREFIX_RE, "").trim();
  s = s.replace(QUOTE_RE, "").trim();
  return (s[0] || org[0] || "?").toUpperCase();
}

const ORG_FULL_FORMS = [
  [/публичное\s+акционерное\s+общество/i, "ПАО"],
  [/закрытое\s+акционерное\s+общество/i, "ЗАО"],
  [/открытое\s+акционерное\s+общество/i, "ОАО"],
  [/общество\s+с\s+ограниченной\s+ответственностью/i, "ООО"],
  [/акционерное\s+общество/i, "АО"],
  [/индивидуальный\s+предприниматель/i, "ИП"],
  // Anchored: "И П Иванов" / "И. П. Иванов" / "И.П. Иванов" at the very start
  // collapse to "ИП". The trailing-space lookahead prevents matching inside
  // an org name that happens to contain those letters.
  [/^(\s*)И\s*\.?\s*П\s*\.?(?=\s)/i, "$1ИП"],
];
function shortOrg(org) {
  if (!org) return org;
  let s = String(org);
  for (const [re, abbr] of ORG_FULL_FORMS) {
    if (re.test(s)) {
      s = s.replace(re, abbr);
      break;
    }
  }
  return s.replace(/\s+/g, " ").trim();
}

function parseQRString(qr) {
  const p = {};
  qr.split("&").forEach((part) => {
    const [k, ...v] = part.split("=");
    p[k] = v.join("=");
  });
  const t = p.t || "";
  const date =
    t.length >= 8 ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}` : "";
  return {
    date,
    amount: p.s ? String(parseFloat(p.s)) : "",
    fn: p.fn || "",
    fd: p.i || "",
    fpd: p.fp || "",
    type: p.n || "",
  };
}

// Обратная к parseQRString: собирает QR-строку чека из ручных реквизитов, чтобы
// проверить чек тем же эндпоинтом /api/fns/check, что и скан. Формат как в QR на
// чеке: t=ГГГГММДДTЧЧММ (дата+время до минуты, ФНС сверяет по ней) & s=рубли.копейки
// & fn=ФН & i=ФД № & fp=ФПД & n=тип операции (1 приход / 2 возврат прихода / 3 расход
// / 4 возврат расхода). Поля fn/fd/fpd НЕ логируем (фискальные данные).
function buildQRString({ date, time, amount, fn, fd, fpd, opType }) {
  const t = `${(date || "").replace(/-/g, "")}T${(time || "").replace(
    ":",
    "",
  )}`;
  const s = Number(String(amount).replace(",", ".")).toFixed(2);
  return `t=${t}&s=${s}&fn=${fn}&i=${fd}&fp=${fpd}&n=${opType}`;
}

const toLocalISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
const todayISO = () => toLocalISO(new Date());
const daysAgoISO = (d) => {
  const x = new Date();
  x.setDate(x.getDate() - d);
  return toLocalISO(x);
};
const monthStartISO = () => {
  const x = new Date();
  x.setDate(1);
  return toLocalISO(x);
};
const quarterStartISO = () => {
  const d = new Date();
  return toLocalISO(
    new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1),
  );
};

// ─── GLOBAL PERIOD ────────────────────────────────────────
const PERIOD_OPTIONS = [
  { key: "week", label: "Неделя" },
  { key: "month", label: "Месяц" },
  { key: "quarter", label: "Квартал" },
  { key: "year", label: "Год" },
  { key: "all", label: "Все" },
];
const periodLabel = (k) =>
  (PERIOD_OPTIONS.find((o) => o.key === k) || PERIOD_OPTIONS[1]).label;
const periodKey = (l) =>
  (PERIOD_OPTIONS.find((o) => o.label === l) || PERIOD_OPTIONS[1]).key;
function inPeriod(date, period) {
  if (!date) return false;
  if (period === "all") return true;
  if (period === "week") return date >= daysAgoISO(7);
  if (period === "month") return date.slice(0, 7) === todayISO().slice(0, 7);
  if (period === "quarter") return date >= quarterStartISO();
  if (period === "year") return date.slice(0, 4) === todayISO().slice(0, 4);
  return true;
}
const fmtDateTime = (ts) => {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

function groupByMonth(items) {
  const g = {};
  items.forEach((r) => {
    const k = r.date.slice(0, 7);
    if (!g[k]) g[k] = { label: monthLabel(r.date), items: [] };
    g[k].items.push(r);
  });
  return Object.entries(g).sort((a, b) => b[0].localeCompare(a[0]));
}

// ─── ATOMS ────────────────────────────────────────────────

function SectionHead({ num, title }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        margin: "16px 0 8px",
      }}
    >
      {num && (
        <div
          style={{
            width: 20,
            height: 20,
            background: C.lightGray,
            color: C.gray,
            fontSize: 9,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: FONT,
            flexShrink: 0,
          }}
        >
          {num}
        </div>
      )}
      <span
        style={{
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: C.mid,
          fontFamily: FONT,
        }}
      >
        {title}
      </span>
      <div style={{ flex: 1, height: "0.5px", background: C.silver }} />
    </div>
  );
}

function Btn({ children, onClick, disabled, outline, full, small, loading }) {
  // loading: in-flight submit — keep the cherry fill, dim to 0.6, block clicks.
  const off = disabled || loading;
  return (
    <button
      onClick={onClick}
      disabled={off}
      style={{
        background: loading
          ? C.cherry
          : disabled
            ? C.lightGray
            : outline
              ? "transparent"
              : C.cherry,
        color: loading
          ? C.white
          : disabled
            ? C.grayL
            : outline
              ? C.cherry
              : C.white,
        border: `1.5px solid ${disabled && !loading ? C.silver : C.cherry}`,
        padding: small ? "6px 12px" : "9px 18px",
        fontFamily: FONT,
        fontSize: 10,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        cursor: off ? "default" : "pointer",
        opacity: loading ? 0.6 : 1,
        transition: "all 0.15s",
        width: full ? "100%" : "auto",
        borderRadius: 6,
      }}
    >
      {children}
    </button>
  );
}

function RuleInput({ label, value, onChange, type = "text", placeholder }) {
  const [f, setF] = useState(false);
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          fontSize: 9,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: C.gray,
          marginBottom: 4,
          fontFamily: FONT,
        }}
      >
        {label}
      </div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        onFocus={() => setF(true)}
        onBlur={() => setF(false)}
        style={{
          width: "100%",
          border: "none",
          borderBottom: `1.5px solid ${f ? C.cherry : C.silver}`,
          outline: "none",
          padding: "7px 0",
          fontSize: 13,
          fontFamily: FONT,
          color: C.dark,
          background: "transparent",
          boxSizing: "border-box",
          transition: "border-color 0.2s",
        }}
      />
    </div>
  );
}

function TabBar({ tabs, active, onSelect }) {
  return (
    <div
      style={{
        display: "flex",
        borderBottom: `1px solid ${C.silver}`,
        background: C.white,
        overflowX: "auto",
      }}
    >
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => onSelect(t)}
          style={{
            padding: "10px 14px",
            border: "none",
            background: "transparent",
            color: active === t ? C.cherry : C.gray,
            fontFamily: FONT,
            fontSize: 10,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            cursor: "pointer",
            whiteSpace: "nowrap",
            flexShrink: 0,
            borderBottom:
              active === t ? `2px solid ${C.cherry}` : "2px solid transparent",
            transition: "all 0.15s",
          }}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

function Block({ children, style: s }) {
  return (
    <div
      style={{
        background: C.lightGray,
        borderLeft: `3px solid ${C.cherryM}`,
        padding: "10px 14px",
        marginBottom: 10,
        ...s,
      }}
    >
      {children}
    </div>
  );
}

function Modal({ title, onClose, children, footer }) {
  const dialogRef = useModalA11y(onClose);
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(22,26,29,0.45)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{
          background: C.white,
          width: "100%",
          maxWidth: 480,
          borderTop: `3px solid ${C.cherry}`,
          maxHeight: "82vh",
          display: "flex",
          flexDirection: "column",
          borderRadius: "12px 12px 0 0",
          overflow: "hidden",
          outline: "none",
        }}
      >
        <div
          style={{
            background: C.lightGray,
            borderBottom: `1px solid ${C.silver}`,
            padding: "11px 16px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 3, height: 14, background: C.cherry }} />
            <span
              style={{
                fontSize: 11,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: C.dark,
                fontFamily: FONT,
              }}
            >
              {title}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            style={{
              border: "none",
              background: "none",
              color: C.gray,
              cursor: "pointer",
              fontSize: 16,
            }}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <div style={{ overflow: "auto", flex: 1, padding: "4px 16px 8px" }}>
          {children}
        </div>
        {footer && (
          <div
            style={{
              padding: "10px 16px calc(10px + env(safe-area-inset-bottom))",
              borderTop: `1px solid ${C.silver}`,
              background: C.lightGray,
              flexShrink: 0,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

function SegmentedControl({ segments, active, onChange }) {
  return (
    <div
      style={{
        display: "flex",
        background: "#E6E9EF",
        borderRadius: 8,
        padding: 2,
        gap: 2,
      }}
    >
      {segments.map((s) => {
        const on = s === active;
        return (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            aria-pressed={on}
            style={{
              flex: 1,
              textAlign: "center",
              padding: "6px 2px",
              borderRadius: 6,
              cursor: "pointer",
              userSelect: "none",
              background: on ? C.white : "transparent",
              color: on ? "#A4161A" : "#636B7D",
              border: on ? "1px solid #EEF0F4" : "1px solid transparent",
              boxShadow: on ? "0 1px 3px rgba(17,19,24,0.12)" : "none",
              fontSize: 11,
              fontFamily: FONT,
              fontWeight: on ? 600 : 500,
              transition:
                "background 180ms ease, color 180ms ease, box-shadow 180ms ease",
            }}
          >
            {s}
          </button>
        );
      })}
    </div>
  );
}

function SectionCard({ title, num, children }) {
  return (
    <div
      style={{
        background: C.white,
        border: `1px solid ${C.silver}`,
        marginBottom: 8,
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: 32,
          background: "#F6F7F9",
          borderBottom: `1px solid ${C.silver}`,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 14px",
        }}
      >
        {num && (
          <span
            style={{
              fontSize: 9,
              fontFamily: "'Courier New', Courier, monospace",
              color: "#9CA3AF",
            }}
          >
            {num}
          </span>
        )}
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.12em",
            color: "#636B7D",
            fontFamily: FONT,
            textTransform: "uppercase",
          }}
        >
          {title}
        </span>
      </div>
      <div style={{ padding: "4px 14px 8px" }}>{children}</div>
    </div>
  );
}

// L-shaped corner markers for the cutout. Four absolutely-positioned divs,
// each drawing the two relevant borders. Color animates between white (idle)
// and #15803D (just captured) via a 300ms transition on border-color.
function CutoutCorners({ size, color, len = 20, thick = 3 }) {
  const off = `calc(50% - ${size / 2}px)`;
  const transition = "border-color 300ms ease";
  const tl = {
    position: "absolute",
    width: len,
    height: len,
    top: off,
    left: off,
    borderTop: `${thick}px solid ${color}`,
    borderLeft: `${thick}px solid ${color}`,
    transition,
    pointerEvents: "none",
  };
  const tr = {
    position: "absolute",
    width: len,
    height: len,
    top: off,
    right: off,
    borderTop: `${thick}px solid ${color}`,
    borderRight: `${thick}px solid ${color}`,
    transition,
    pointerEvents: "none",
  };
  const bl = {
    position: "absolute",
    width: len,
    height: len,
    bottom: off,
    left: off,
    borderBottom: `${thick}px solid ${color}`,
    borderLeft: `${thick}px solid ${color}`,
    transition,
    pointerEvents: "none",
  };
  const br = {
    position: "absolute",
    width: len,
    height: len,
    bottom: off,
    right: off,
    borderBottom: `${thick}px solid ${color}`,
    borderRight: `${thick}px solid ${color}`,
    transition,
    pointerEvents: "none",
  };
  return (
    <>
      <div style={tl} />
      <div style={tr} />
      <div style={bl} />
      <div style={br} />
    </>
  );
}

// Otsu's method: pick the grayscale threshold maximizing between-class
// variance, then binarize the RGBA buffer in place to pure black/white.
// Helps jsQR on phone photos with uneven lighting / shadows.
function binarizeOtsu(data) {
  const n = data.length / 4;
  const gray = new Uint8Array(n);
  const hist = new Array(256).fill(0);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const g = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
    gray[p] = g;
    hist[g]++;
  }
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0,
    wB = 0,
    maxVar = 0,
    threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = n - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      threshold = t;
    }
  }
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const v = gray[p] > threshold ? 255 : 0;
    data[i] = data[i + 1] = data[i + 2] = v;
  }
}

// Contrast stretch: (v - 128) * 2 + 128 per RGB channel, clamped to 0..255.
function contrast2x(data) {
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = (data[i + c] - 128) * 2 + 128;
      data[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
}

// Draw img at the requested scale (number, or "fit-N" = cap long side at N px,
// never upscale) and optionally post-process pixels. Returns ImageData for jsQR.
function prepareImageData(img, { scale, process }) {
  let s;
  if (typeof scale === "number") s = scale;
  else {
    const px = parseInt(String(scale).replace("fit-", ""), 10) || 1000;
    s = Math.min(1, px / Math.max(img.width, img.height));
  }
  const w = Math.max(1, Math.round(img.width * s));
  const h = Math.max(1, Math.round(img.height * s));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  if (process === "binarize-otsu") binarizeOtsu(data.data);
  else if (process === "contrast-2x") contrast2x(data.data);
  return data;
}

// True only for the standard FNS fiscal QR, which carries t= (timestamp),
// &fn= (fiscal drive number) and &fp= (fiscal sign). Everything else —
// netmonet/tips, URLs, contacts — lacks these and is rejected.
function isFiscalQR(text) {
  return (
    !!text &&
    text.includes("t=") &&
    text.includes("&fn=") &&
    text.includes("&fp=")
  );
}

const QR_MASK_PADDING = 6; // px of slack around a QR's bounding box when erasing it

// Erase an already-read QR from the ImageData buffer IN PLACE so jsQR can find
// the next QR on the same canvas. Fills the axis-aligned box covering all four
// corners (+padding) with white — destroys the finder patterns reliably even
// if the QR is slightly rotated. Mutates `imageData.data`.
function maskQrRegion(imageData, location) {
  const xs = [
    location.topLeftCorner.x,
    location.topRightCorner.x,
    location.bottomLeftCorner.x,
    location.bottomRightCorner.x,
  ];
  const ys = [
    location.topLeftCorner.y,
    location.topRightCorner.y,
    location.bottomLeftCorner.y,
    location.bottomRightCorner.y,
  ];
  const w = imageData.width,
    h = imageData.height,
    d = imageData.data;
  const x0 = Math.max(0, Math.floor(Math.min(...xs)) - QR_MASK_PADDING);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)) - QR_MASK_PADDING);
  const x1 = Math.min(w, Math.ceil(Math.max(...xs)) + QR_MASK_PADDING);
  const y1 = Math.min(h, Math.ceil(Math.max(...ys)) + QR_MASK_PADDING);
  for (let y = y0; y < y1; y++) {
    let i = (y * w + x0) * 4;
    for (let x = x0; x < x1; x++, i += 4) {
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = 255; // white = no QR here
    }
  }
}

// Find the FISCAL QR on a receipt photo via jsQR. Cascade of attempts
// (fast → slow) with different scales + pixel pre-processing; within each
// attempt, mask-and-retry skips non-fiscal QRs (e.g. the big netmonet/tips QR)
// until a fiscal one is found. Returns the fiscal QR string or null (→ OCR).
// Used only for the photo-upload path — live camera uses html5-qrcode.
async function decodeQrFromFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("image load failed"));
      i.src = url;
    });

    const attempts = [
      { scale: 1, process: "none" }, // native resolution, as-is
      { scale: "fit-1000", process: "none" }, // medium size — jsQR detects reliably
      { scale: "fit-1000", process: "binarize-otsu" }, // adaptive black/white
      { scale: "fit-1500", process: "contrast-2x" }, // bigger + hard contrast
      { scale: "fit-600", process: "binarize-otsu" }, // small + binarized (huge photos)
    ];

    const MAX_QRS_PER_ATTEMPT = 5; // safety cap on mask-and-retry within one canvas

    for (let n = 0; n < attempts.length; n++) {
      const a = attempts[n];
      // Yield so React can repaint the "(N сек)" timer between these heavy,
      // synchronous jsQR passes instead of freezing the UI for the whole cascade.
      await new Promise((r) => setTimeout(r, 0));
      try {
        // Fresh ImageData per cascade attempt — masking below mutates this
        // buffer in place, so it must NOT be carried over to the next attempt.
        const data = prepareImageData(img, a);
        for (let k = 0; k < MAX_QRS_PER_ATTEMPT; k++) {
          if (k > 0) await new Promise((r) => setTimeout(r, 0)); // keep the timer alive between re-scans
          const code = jsQR(data.data, data.width, data.height, {
            inversionAttempts: "attemptBoth",
          });
          if (!code || !code.data) break; // no more QRs on this canvas → next cascade attempt
          if (isFiscalQR(code.data)) return code.data;
          maskQrRegion(data, code.location); // non-fiscal QR → erase in place, re-scan the SAME buffer
        }
      } catch {
        /* this attempt failed — try the next preprocessing */
      }
    }
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Auto-loading scanner, full-screen native-style layout (iPhone-like):
//   1. `scanning`  — camera fills the screen; dark overlay with a 270px
//      cutout in the center; white L-corner markers at the cutout corners.
//   2. `captured`  — pause(true) freezes the frame; corners go green; bottom
//      pill shows the local QR preview + "Отмена". After 1s the FNS lookup
//      auto-starts (no button) → `loading`.
//   3. `loading`   — full dim; bottom pill shows a spinner + "Отмена".
//   4. `fnsError`  — full dim; bottom pill offers OCR / retry / manual entry.
//   5. `cameraError` — full dim; bottom pill offers manual entry.
//
// "Отмена" (in `captured` or `loading`) cancels the auto-load, discards any
// in-flight result and resumes scanning.
//
// `onCapture(qrText) => Promise<'ok'|'partial'>` is the only network-touching
// prop; the modal owns its own UI transitions but never decides what counts
// as success.
// Step-by-step progress while a photo is processed (QR → ФНС → OCR). Active
// step: cherry spinner; completed steps: gray check. Brand v12 §11.
function ProcessingSteps({ step }) {
  // Variant B: honest elapsed-time readout under "Ищем QR-код" — the QR cascade
  // can run a beat, so a ticking "(N сек)" reassures the user it's working.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (step !== "qr") return;
    const start = Date.now();
    const id = setInterval(() => setElapsed((Date.now() - start) / 1000), 100);
    return () => clearInterval(id);
  }, [step]);
  const spinner = (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#A4161A"
      strokeWidth="3"
      style={{ flexShrink: 0 }}
    >
      <circle cx="12" cy="12" r="9" strokeOpacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round">
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 12 12"
          to="360 12 12"
          dur="0.8s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  );
  const done = (text) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontFamily: FONT,
        fontSize: 14,
        color: "#636B7D",
      }}
    >
      <span
        style={{
          flexShrink: 0,
          color: "#15803D",
          fontSize: 15,
          width: 16,
          textAlign: "center",
        }}
      >
        ✓
      </span>
      {text}
    </div>
  );
  const active = (text) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontFamily: FONT,
        fontSize: 14,
        color: "#111318",
      }}
    >
      {spinner}
      {text}
    </div>
  );
  return (
    <div
      style={{
        background: "#FFFFFF",
        padding: 20,
        borderRadius: 12,
        maxWidth: 320,
        width: "calc(100% - 48px)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        boxShadow: "0 8px 30px rgba(17,19,24,0.25)",
      }}
    >
      {step === "qr" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontFamily: FONT,
            fontSize: 14,
            color: "#111318",
          }}
        >
          {spinner}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              lineHeight: 1.3,
            }}
          >
            <span>Ищем QR-код в файле…</span>
            <span
              style={{
                fontSize: 12,
                color: "#9CA3AF",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              ({elapsed.toFixed(1)} сек)
            </span>
          </div>
        </div>
      )}
      {step === "fns" && (
        <>
          {done("QR-код найден")}
          {active("Проверяем чек в базе ФНС…")}
        </>
      )}
      {step === "ocr_noqr" && (
        <>
          {done("QR-код не найден")}
          {active("Распознаём текст чека…")}
        </>
      )}
      {step === "ocr_fns" && (
        <>
          {done("ФНС не подтвердила")}
          {active("Распознаём текст чека…")}
        </>
      )}
    </div>
  );
}

// Styled bottom-sheet shown when a QR was found but ФНС couldn't confirm it
// (not_found / unavailable). Replaces the native confirm(). Brand v12 §11.
function SaveAsPhotoSheet({
  title,
  message,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
}) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 300,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <style>
        {
          "@keyframes aocg-slideup{from{transform:translateY(100%)}to{transform:translateY(0)}}"
        }
      </style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 480,
          background: "#fff",
          borderRadius: "16px 16px 0 0",
          padding: "24px 20px calc(24px + env(safe-area-inset-bottom))",
          animation: "aocg-slideup 200ms ease",
        }}
      >
        <div
          style={{
            fontFamily: FONT,
            fontWeight: 600,
            fontSize: 18,
            color: "#111318",
            marginBottom: 8,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontFamily: FONT,
            fontSize: 14,
            color: "#636B7D",
            lineHeight: 1.45,
            marginBottom: 24,
          }}
        >
          {message}
        </div>
        <button
          type="button"
          onClick={onConfirm}
          style={{
            width: "100%",
            height: 48,
            borderRadius: 12,
            background: "#A4161A",
            border: "none",
            color: "#fff",
            fontFamily: FONT,
            fontSize: 15,
            fontWeight: 600,
            cursor: "pointer",
            transition: "opacity 120ms",
          }}
        >
          {confirmText}
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            width: "100%",
            height: 48,
            marginTop: 8,
            borderRadius: 12,
            background: "#fff",
            border: "1px solid #EEF0F4",
            color: "#636B7D",
            fontFamily: FONT,
            fontSize: 15,
            cursor: "pointer",
            transition: "opacity 120ms",
          }}
        >
          {cancelText}
        </button>
      </div>
    </div>
  );
}

function ScanReceiptModal({
  onClose,
  onCapture,
  onPrefetch,
  onOcrFile,
  onManual,
}) {
  const [phase, setPhase] = useState("scanning"); // scanning | captured | loading | fnsError | cameraError | preview
  const [loadingMsg, setLoadingMsg] = useState("Загружаем данные из ФНС…");
  const [notice, setNotice] = useState(""); // subtle gray bottom notification (replaces red banner)
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [qrText, setQrText] = useState("");
  const [qrParsed, setQrParsed] = useState(null);
  const [flashGreen, setFlashGreen] = useState(false); // 0.5s green pulse on capture
  const [previewFile, setPreviewFile] = useState(null); // chosen photo/file awaiting confirmation
  const [previewUrl, setPreviewUrl] = useState(null); // object URL for the image preview (null for PDFs)
  const [previewNotice, setPreviewNotice] = useState(""); // OCR-failure notice on the preview screen
  const [step, setStep] = useState(null); // null|'qr'|'fns'|'ocr_noqr'|'ocr_fns'|'done' — photo-processing progress
  const [saveSheet, setSaveSheet] = useState(null); // {title,message,confirmText,cancelText} — FNS-fallback sheet
  const [fileSource, setFileSource] = useState(null); // 'camera' | 'gallery' | null — where the previewed file came from
  const scannerRef = useRef(null);
  const streamRef = useRef(null); // реальный MediaStream — освобождение без зависимости от DOM
  const cameraOn = useRef(false);
  const ocrFileRef = useRef(null);
  const cameraInputRef = useRef(null); // <input capture="environment"> — take a photo
  const galleryInputRef = useRef(null); // <input> — pick from gallery (native picker, no capture)
  const previewUrlRef = useRef(null); // tracks the live object URL so we can revoke it
  const mountedRef = useRef(true);
  const autoTimerRef = useRef(null); // the 1s "captured → auto-load" timer
  const cancelledRef = useRef(false); // user tapped "Отмена"; discard any in-flight result

  // Latest callbacks behind a ref so the auto-load timer and the camera
  // effect (keyed on stable values) never restart just because the parent
  // re-rendered with fresh prop identities. The parent recreates onPrefetch /
  // onCapture every render; if `capture` depended on them directly it would
  // churn `startCamera` → tear down and restart html5-qrcode mid-scan, which
  // throws "Cannot clear while scan is ongoing" and white-screens the app.
  const cbRef = useRef({ onCapture, onClose, onPrefetch });
  useEffect(() => {
    cbRef.current = { onCapture, onClose, onPrefetch };
  });

  const CUTOUT = 270; // visual cutout size in px; matches design spec
  const cornerColor =
    phase === "captured" || flashGreen ? "#15803D" : "#FFFFFF";

  useEffect(
    () => () => {
      mountedRef.current = false;
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  const capture = useCallback((text) => {
    try {
      if (navigator.vibrate) navigator.vibrate(100);
    } catch {
      /* ignored */
    }
    setFlashGreen(true);
    setQrText(text);
    setQrParsed(parseQRString(text));
    setPhase("captured");
    const pf = cbRef.current.onPrefetch;
    if (pf) {
      try {
        pf(text);
      } catch {
        /* ignored */
      }
    }
    setTimeout(() => {
      if (mountedRef.current) setFlashGreen(false);
    }, 500);
  }, []);

  const startCamera = useCallback(() => {
    if (!scannerRef.current) scannerRef.current = new Html5Qrcode("qr-reader");
    const s = scannerRef.current;
    // No `qrbox` config: that would make html5-qrcode draw its own dark
    // shaded overlay, which would stack with our cutout overlay and look
    // broken. Without qrbox the lib scans the full frame and renders only
    // a bare <video>, leaving the visual layer entirely to us.
    const config = {
      fps: 15,
      disableFlip: false,
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    };
    s.start(
      { facingMode: "environment" },
      config,
      (text) => {
        if (!cameraOn.current) return;
        if (!isFiscalQR(text)) {
          console.log("[Camera] non-fiscal QR ignored:", text.substring(0, 60));
          return; // keep scanning — don't pause on a non-fiscal QR (netmonet/url)
        }
        console.log("[Camera] fiscal QR detected"); // no QR text in logs (fn privacy)
        cameraOn.current = false;
        try {
          s.pause(true);
        } catch {
          /* not in scanning state */
        }
        capture(text);
      },
      () => {
        /* per-frame parse failures are noise */
      },
    )
      .then(() => {
        cameraOn.current = true;
        const vEl = document
          .getElementById("qr-reader")
          ?.querySelector("video");
        streamRef.current = vEl && vEl.srcObject ? vEl.srcObject : null;
        try {
          const caps = s.getRunningTrackCapabilities?.() || {};
          if (caps.torch) setTorchSupported(true);
          if (
            Array.isArray(caps.focusMode) &&
            caps.focusMode.includes("continuous")
          ) {
            s.applyVideoConstraints({
              advanced: [{ focusMode: "continuous" }],
            }).catch(() => {});
          }
        } catch {
          /* capabilities unavailable */
        }
      })
      .catch((err) => {
        const name = err && err.name;
        if (name === "NotAllowedError" || name === "PermissionDeniedError")
          setNotice(
            "Нет доступа к камере. Разрешите доступ в настройках браузера.",
          );
        else if (name === "NotReadableError" || name === "TrackStartError")
          setNotice(
            "Камера занята другим приложением. Закройте его и попробуйте снова.",
          );
        else setNotice("Не удалось включить камеру. Попробуйте ещё раз.");
        setPhase("cameraError");
      });
  }, [capture]);

  // Освобождение камеры: синхронно глушим треки (железно, без гонки с DOM),
  // фоном добиваем html5-qrcode (stop → clear). Идемпотентно: повтор → no-op.
  const releaseCamera = useCallback(() => {
    cameraOn.current = false;
    try {
      streamRef.current &&
        streamRef.current.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignored */
    }
    const s = scannerRef.current;
    if (s)
      Promise.resolve()
        .then(() => s.stop())
        .catch(() => {})
        .then(() => {
          try {
            s.clear();
          } catch {
            /* ignored */
          }
        })
        .catch(() => {});
    streamRef.current = null;
    scannerRef.current = null;
  }, []);

  useEffect(() => {
    startCamera();
    return () => releaseCamera();
  }, [startCamera, releaseCamera]);

  async function toggleTorch() {
    if (!scannerRef.current || !cameraOn.current) return;
    const next = !torchOn;
    try {
      await scannerRef.current.applyVideoConstraints({
        advanced: [{ torch: next }],
      });
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
    }
  }

  async function rescan() {
    setNotice("");
    setQrText("");
    setQrParsed(null);
    setFlashGreen(false);
    setPhase("scanning");
    const s = scannerRef.current;
    try {
      if (s && s.getState && s.getState() === Html5QrcodeScannerState.PAUSED) {
        s.resume();
        cameraOn.current = true;
        return;
      }
    } catch {
      /* ignored */
    }
    if (s) {
      try {
        await s.stop().catch(() => {});
      } catch {
        /* ignored */
      }
    }
    scannerRef.current = null;
    cameraOn.current = false;
    startCamera();
  }

  // Fire the FNS lookup and resolve the modal. Stable identity so the
  // auto-load effect below isn't disturbed by parent re-renders.
  const runFnsLoad = useCallback(async (text) => {
    if (!text || !cbRef.current.onCapture) return;
    setLoadingMsg("Загружаем данные из ФНС…");
    setPhase("loading");
    let result;
    try {
      result = await cbRef.current.onCapture(text);
    } catch {
      result = "partial";
    }
    if (!mountedRef.current || cancelledRef.current) return; // cancelled mid-flight → keep scanning
    if (result === "ok") {
      releaseCamera();
      cbRef.current.onClose();
    } else setPhase("fnsError");
  }, []);

  // Auto-load: 1s after a QR is captured, kick off the FNS lookup with no
  // button press (iPhone-style). The window lets the user read the preview
  // and tap "Отмена" first. Keyed on phase+qrText so it fires once per
  // capture and a parent re-render can't reset the countdown.
  useEffect(() => {
    if (phase !== "captured") return;
    cancelledRef.current = false;
    autoTimerRef.current = setTimeout(() => {
      if (mountedRef.current && !cancelledRef.current) runFnsLoad(qrText);
    }, 1000);
    return () => {
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    };
  }, [phase, qrText, runFnsLoad]);

  // "Отмена" — works during the 1s preview window and during loading. Cancels
  // the pending auto-load, discards any in-flight result, resumes scanning.
  function cancel(e) {
    if (e && e.preventDefault) e.preventDefault();
    cancelledRef.current = true;
    if (autoTimerRef.current) {
      clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
    rescan();
  }

  async function handleOcrPick(file) {
    if (!file || !onOcrFile) return;
    cancelledRef.current = false;
    setLoadingMsg("Распознаём чек…");
    setPhase("loading");
    let result;
    try {
      result = await onOcrFile(file);
    } catch {
      result = "partial";
    }
    if (!mountedRef.current || cancelledRef.current) return;
    if (result === "ok") {
      releaseCamera();
      onClose();
    } else setPhase("fnsError");
  }

  // ─── Photo upload: source sheet → preview → use ────────────────
  function revokePreviewUrl() {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }
  function clearPreview() {
    revokePreviewUrl();
    setPreviewUrl(null);
    setPreviewFile(null);
    setPreviewNotice("");
    setStep(null);
    setSaveSheet(null);
    setFileSource(null);
  }

  // A source input fired. Stash the file and show the preview screen; QR
  // decode / OCR are deferred to "Использовать". Images get an object URL;
  // PDFs fall back to a filename placeholder (no inline render).
  function pickFile(file) {
    if (!file) return;
    cameraOn.current = false; // gate the live scanner while the preview is up
    revokePreviewUrl();
    const url =
      file.type && file.type.startsWith("image/")
        ? URL.createObjectURL(file)
        : null;
    previewUrlRef.current = url;
    setPreviewUrl(url);
    setPreviewFile(file);
    setPreviewNotice("");
    setStep(null);
    setPhase("preview");
  }

  function previewBack(e) {
    // ‹ Назад — abandon the photo, back to the live camera
    if (e && e.preventDefault) e.preventDefault();
    clearPreview();
    setPhase("scanning");
    cameraOn.current = true;
  }
  function previewRetake(e) {
    // Переснять / Выбрать другое — re-open the SAME source the file came from
    if (e && e.preventDefault) e.preventDefault();
    const src = fileSource; // capture before clearPreview() resets it to null
    clearPreview();
    setPhase("scanning"); // safety for all branches: if the user cancels the picker,
    cameraOn.current = true; // they land on the live scanner, not an empty preview
    if (src === "camera") cameraInputRef.current?.click();
    else if (src === "gallery") galleryInputRef.current?.click();
  }

  // "Использовать": QR-first photo processing with a step indicator.
  //   QR found + ФНС ok   → form (source=qr_scan)
  //   QR found + 404/503  → SaveAsPhotoSheet → OCR (source=photo_ocr)
  //   no QR               → OCR (source=photo_ocr)
  // decodeQrFromFile / onCapture / onOcrFile are reused as-is; the live-camera
  // capture()→runFnsLoad path is untouched. previewFile is kept until success
  // so the OCR fallback (sheet confirm) still has the file.
  async function usePhoto(e) {
    if (e && e.preventDefault) e.preventDefault();
    const file = previewFile;
    if (!file) return;
    setPreviewNotice("");
    setStep("qr");
    let text = null;
    try {
      text = await decodeQrFromFile(file);
    } catch {
      /* not an image, or no QR — fall through to OCR */
    }
    if (!mountedRef.current) return;

    if (!text) {
      await runOcr(file, false);
      return;
    } // no QR → OCR

    setStep("fns");
    let result;
    try {
      result = await onCapture(text);
    } catch {
      // handleCapture: fills form, returns ok|not_found|unavailable|partial
      result = "partial";
    }
    if (!mountedRef.current) return;

    if (result === "ok") {
      setStep("done");
      clearPreview();
      releaseCamera();
      onClose();
      return;
    }

    // ФНС не подтвердила — спросить, сохранить ли как фото (OCR).
    setStep(null);
    const unavailable = result === "unavailable";
    setSaveSheet({
      title: unavailable ? "ФНС временно недоступна" : "Чек не найден в ФНС",
      message: unavailable
        ? "Не удалось проверить чек через ФНС. Сохранить как фото? Позже можно проверить вручную."
        : "Возможно, чек старше 30 дней или не зарегистрирован. Сохранить как фото?",
      confirmText: "Сохранить как фото",
      cancelText: unavailable ? "Попробовать позже" : "Отменить",
    });
  }

  // OCR a photo and resolve the modal. fromFns toggles the first (gray) step label.
  async function runOcr(file, fromFns) {
    if (!onOcrFile) {
      setStep(null);
      setPreviewNotice("Не удалось распознать. Заполните вручную");
      return;
    }
    setStep(fromFns ? "ocr_fns" : "ocr_noqr");
    let result;
    try {
      result = await onOcrFile(file);
    } catch {
      result = "partial";
    }
    if (!mountedRef.current) return;
    if (result === "ok") {
      setStep("done");
      clearPreview();
      releaseCamera();
      onClose();
    } else {
      setStep(null);
      setPreviewNotice("Не удалось распознать. Заполните вручную");
    }
  }

  // ─── UI ────────────────────────────────────────────────────────
  const dimmed =
    phase === "loading" || phase === "fnsError" || phase === "cameraError";

  const dialogRef = useModalA11y(onClose);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Сканировать чек"
      tabIndex={-1}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "#000",
        overflow: "hidden",
        width: "100vw",
        height: "100dvh",
        outline: "none",
      }}
    >
      {/* Force html5-qrcode's nested <video> to cover the whole viewport. */}
      <style>{`#qr-reader,#qr-reader>div,#qr-reader video{width:100%!important;height:100%!important;object-fit:cover!important;border:none!important}`}</style>

      {/* Camera fills the screen */}
      <div
        id="qr-reader"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
        }}
      />

      {/* Dark overlay with cutout — 4 picture-frame rectangles around a
          transparent 260×260 square in the center. Hidden during loading /
          error phases (where we use a uniform full-screen dim instead). */}
      {!dimmed && phase !== "preview" && (
        <>
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: `calc(50% - ${CUTOUT / 2}px)`,
              background: "rgba(0,0,0,0.55)",
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: `calc(50% - ${CUTOUT / 2}px)`,
              background: "rgba(0,0,0,0.55)",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: `calc(50% - ${CUTOUT / 2}px)`,
              bottom: `calc(50% - ${CUTOUT / 2}px)`,
              left: 0,
              width: `calc(50% - ${CUTOUT / 2}px)`,
              background: "rgba(0,0,0,0.55)",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: `calc(50% - ${CUTOUT / 2}px)`,
              bottom: `calc(50% - ${CUTOUT / 2}px)`,
              right: 0,
              width: `calc(50% - ${CUTOUT / 2}px)`,
              background: "rgba(0,0,0,0.55)",
            }}
          />
          <CutoutCorners size={CUTOUT} color={cornerColor} />
        </>
      )}

      {/* Full-screen dim for loading / FNS error / camera error */}
      {dimmed && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
          }}
        />
      )}

      {/* Top bar — back + flashlight (both white, circular, blurred backdrop).
          Hidden in the preview screen, which carries its own back button. */}
      {phase !== "preview" && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            padding: "calc(env(safe-area-inset-top) + 12px) 16px 12px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            zIndex: 5,
            pointerEvents: "none",
          }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              releaseCamera();
              onClose();
            }}
            aria-label="Назад"
            style={{
              pointerEvents: "auto",
              width: 44,
              height: 44,
              borderRadius: "50%",
              border: "none",
              background: "rgba(0,0,0,0.4)",
              color: "#fff",
              fontSize: 26,
              lineHeight: 1,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backdropFilter: "blur(8px)",
            }}
          >
            ‹
          </button>
          {torchSupported && (phase === "scanning" || phase === "captured") && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                toggleTorch();
              }}
              aria-label="Фонарик"
              aria-pressed={torchOn}
              style={{
                pointerEvents: "auto",
                width: 44,
                height: 44,
                borderRadius: "50%",
                border: "none",
                background: torchOn
                  ? "rgba(255,221,87,0.95)"
                  : "rgba(0,0,0,0.4)",
                color: torchOn ? "#161A1D" : "#fff",
                fontSize: 20,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backdropFilter: "blur(8px)",
              }}
            >
              <Flashlight size={20} />
            </button>
          )}
        </div>
      )}

      {/* Preview / loading / FNS-error all live in the bottom pill now. */}

      {/* Camera error */}
      {phase === "cameraError" && (
        <div
          style={{
            position: "absolute",
            top: "42%",
            left: "50%",
            transform: "translate(-50%,-50%)",
            padding: "12px 18px",
            background: "rgba(255,255,255,0.12)",
            borderRadius: 10,
            maxWidth: 340,
            textAlign: "center",
          }}
        >
          <span style={{ fontSize: 13, color: "#fff", fontFamily: FONT }}>
            {notice || "Нет доступа к камере"}
          </span>
        </div>
      )}

      {/* Soft gray notice — replaces the old red banner. Sits above the cutout. */}
      {notice && phase === "scanning" && (
        <div
          style={{
            position: "absolute",
            bottom: `calc(50% + ${CUTOUT / 2}px + 18px)`,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "10px 14px",
            background: "rgba(0,0,0,0.65)",
            color: "#fff",
            fontFamily: FONT,
            fontSize: 12,
            borderRadius: 10,
            maxWidth: "calc(100vw - 32px)",
            textAlign: "center",
            backdropFilter: "blur(6px)",
            zIndex: 5,
          }}
        >
          {notice}
        </div>
      )}

      {/* Hidden file inputs. Reset value after each pick so re-selecting the
          same file still fires onChange. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="Снять фото чека камерой"
        style={{ display: "none" }}
        onChange={(e) => {
          setFileSource("camera");
          pickFile(e.target.files[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        aria-label="Выбрать фото чека из галереи"
        style={{ display: "none" }}
        onChange={(e) => {
          setFileSource("gallery");
          pickFile(e.target.files[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={ocrFileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="Файл чека для распознавания"
        style={{ display: "none" }}
        onChange={(e) => {
          handleOcrPick(e.target.files[0]);
          e.target.value = "";
        }}
      />

      {/* Bottom pill — white, rounded top, contents swap per phase. Hidden in
          the preview screen, which has its own controls. */}
      {phase !== "preview" && (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            background: "#fff",
            borderRadius: "20px 20px 0 0",
            padding: "18px 16px calc(20px + env(safe-area-inset-bottom))",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            zIndex: 6,
            boxShadow: "0 -4px 20px rgba(0,0,0,0.15)",
          }}
        >
          {phase === "scanning" && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  setNotice("");
                  cameraInputRef.current?.click();
                }}
                onPointerDown={(e) => {
                  e.currentTarget.style.opacity = "0.7";
                }}
                onPointerUp={(e) => {
                  e.currentTarget.style.opacity = "1";
                }}
                onPointerLeave={(e) => {
                  e.currentTarget.style.opacity = "1";
                }}
                style={{
                  width: "100%",
                  height: 52,
                  borderRadius: 12,
                  background: "#fff",
                  border: "1px solid #EEF0F4",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  fontFamily: FONT,
                  fontSize: 15,
                  fontWeight: 500,
                  color: "#111318",
                  cursor: "pointer",
                  transition: "opacity 100ms",
                }}
              >
                <Camera size={20} color="#111318" /> Сделать фото
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  setNotice("");
                  galleryInputRef.current?.click();
                }}
                onPointerDown={(e) => {
                  e.currentTarget.style.opacity = "0.7";
                }}
                onPointerUp={(e) => {
                  e.currentTarget.style.opacity = "1";
                }}
                onPointerLeave={(e) => {
                  e.currentTarget.style.opacity = "1";
                }}
                style={{
                  width: "100%",
                  height: 52,
                  borderRadius: 12,
                  background: "#fff",
                  border: "1px solid #EEF0F4",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  fontFamily: FONT,
                  fontSize: 15,
                  fontWeight: 400,
                  color: "#636B7D",
                  cursor: "pointer",
                  transition: "opacity 100ms",
                }}
              >
                <ImageUp size={20} color="#636B7D" /> Загрузить
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  onManual();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "4px",
                  fontFamily: FONT,
                  fontSize: 13,
                  color: "#9CA3AF",
                }}
              >
                <PenLine size={16} color="#9CA3AF" /> Ввести вручную
              </button>
            </>
          )}

          {phase === "captured" && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: FONT,
                    fontSize: 11,
                    color: C.gray,
                    marginBottom: 3,
                    letterSpacing: "0.02em",
                  }}
                >
                  Чек распознан
                </div>
                <div
                  style={{
                    fontFamily: FONT,
                    fontSize: 15,
                    fontWeight: 600,
                    color: C.dark,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {qrParsed?.amount
                    ? `${Number(qrParsed.amount).toLocaleString("ru-RU", {
                        minimumFractionDigits: 2,
                      })} ₽`
                    : "QR-код"}
                  {qrParsed?.date ? ` · ${fmtDate(qrParsed.date)}` : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={cancel}
                style={{
                  flexShrink: 0,
                  padding: "10px 18px",
                  background: C.lightGray,
                  border: "none",
                  borderRadius: 10,
                  fontFamily: FONT,
                  fontSize: 13,
                  color: C.mid,
                  cursor: "pointer",
                }}
              >
                Отмена
              </button>
            </div>
          )}

          {phase === "loading" && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flex: 1,
                  minWidth: 0,
                }}
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={C.cherry}
                  strokeWidth="2.5"
                  style={{ flexShrink: 0 }}
                >
                  <circle cx="12" cy="12" r="9" strokeOpacity="0.2" />
                  <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round">
                    <animateTransform
                      attributeName="transform"
                      type="rotate"
                      from="0 12 12"
                      to="360 12 12"
                      dur="0.8s"
                      repeatCount="indefinite"
                    />
                  </path>
                </svg>
                <span
                  style={{
                    fontFamily: FONT,
                    fontSize: 14,
                    color: C.dark,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {loadingMsg}
                </span>
              </div>
              <button
                type="button"
                onClick={cancel}
                style={{
                  flexShrink: 0,
                  padding: "10px 18px",
                  background: C.lightGray,
                  border: "none",
                  borderRadius: 10,
                  fontFamily: FONT,
                  fontSize: 13,
                  color: C.mid,
                  cursor: "pointer",
                }}
              >
                Отмена
              </button>
            </div>
          )}

          {phase === "fnsError" && (
            <>
              <div
                style={{
                  textAlign: "center",
                  color: C.gray,
                  fontFamily: FONT,
                  fontSize: 13,
                  marginBottom: 2,
                }}
              >
                Данные ФНС не загрузились
              </div>
              {onOcrFile && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    ocrFileRef.current?.click();
                  }}
                  style={{
                    padding: "14px",
                    background: C.cherry,
                    border: "none",
                    borderRadius: 12,
                    fontFamily: FONT,
                    fontSize: 14,
                    fontWeight: 600,
                    color: C.white,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                  }}
                >
                  <Camera size={16} /> Распознать фото чека
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  cancelledRef.current = false;
                  runFnsLoad(qrText);
                }}
                style={{
                  padding: "12px",
                  background: C.white,
                  border: `1px solid ${C.silver}`,
                  borderRadius: 12,
                  fontFamily: FONT,
                  fontSize: 13,
                  color: C.dark,
                  cursor: "pointer",
                }}
              >
                Попробовать снова
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  onManual(qrText);
                }}
                style={{
                  padding: "12px",
                  background: "none",
                  border: "none",
                  fontFamily: FONT,
                  fontSize: 13,
                  color: C.gray,
                  cursor: "pointer",
                }}
              >
                Заполнить вручную
              </button>
            </>
          )}

          {phase === "cameraError" && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                onManual();
              }}
              style={{
                padding: "14px",
                background: C.cherry,
                border: "none",
                borderRadius: 12,
                fontFamily: FONT,
                fontSize: 14,
                fontWeight: 600,
                color: C.white,
                cursor: "pointer",
              }}
            >
              Ввести вручную
            </button>
          )}
        </div>
      )}

      {/* Preview screen — chosen photo full-screen, confirm or retake */}
      {phase === "preview" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "#000",
            zIndex: 15,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="Предпросмотр чека"
                style={{
                  maxWidth: "100%",
                  maxHeight: "100%",
                  objectFit: "contain",
                }}
              />
            ) : (
              <div
                style={{
                  color: "#fff",
                  fontFamily: FONT,
                  fontSize: 14,
                  textAlign: "center",
                  padding: 24,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <FileText size={52} strokeWidth={1.25} />
                <span style={{ opacity: 0.85, wordBreak: "break-all" }}>
                  {previewFile?.name || "Файл выбран"}
                </span>
              </div>
            )}
          </div>

          {/* Back button */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              padding: "calc(env(safe-area-inset-top) + 12px) 16px 12px",
            }}
          >
            <button
              type="button"
              onClick={previewBack}
              aria-label="Назад"
              style={{
                width: 44,
                height: 44,
                borderRadius: "50%",
                border: "none",
                background: "rgba(0,0,0,0.45)",
                color: "#fff",
                fontSize: 26,
                lineHeight: 1,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backdropFilter: "blur(8px)",
              }}
            >
              ‹
            </button>
          </div>

          {/* Bottom controls */}
          <div
            style={{
              padding: "18px 16px calc(20px + env(safe-area-inset-bottom))",
              background:
                "linear-gradient(to top, rgba(0,0,0,0.7), transparent)",
            }}
          >
            {step ? (
              <div style={{ display: "flex", justifyContent: "center" }}>
                <ProcessingSteps step={step} />
              </div>
            ) : previewNotice ? (
              <div
                style={{ display: "flex", flexDirection: "column", gap: 10 }}
              >
                <div
                  style={{
                    textAlign: "center",
                    color: "#fff",
                    fontFamily: FONT,
                    fontSize: 13,
                    background: "rgba(255,255,255,0.14)",
                    borderRadius: 10,
                    padding: "10px 14px",
                  }}
                >
                  {previewNotice}
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    onManual();
                  }}
                  style={{
                    padding: "14px",
                    background: C.cherry,
                    border: "none",
                    borderRadius: 12,
                    fontFamily: FONT,
                    fontSize: 14,
                    fontWeight: 600,
                    color: C.white,
                    cursor: "pointer",
                  }}
                >
                  Заполнить вручную
                </button>
                <button
                  type="button"
                  onClick={previewRetake}
                  style={{
                    padding: "12px",
                    background: "rgba(255,255,255,0.12)",
                    border: "1px solid rgba(255,255,255,0.4)",
                    borderRadius: 12,
                    fontFamily: FONT,
                    fontSize: 13,
                    color: "#fff",
                    cursor: "pointer",
                  }}
                >
                  {fileSource === "camera" ? "Переснять" : "Выбрать другое"}
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 12 }}>
                <button
                  type="button"
                  onClick={previewRetake}
                  style={{
                    flex: 1,
                    padding: "14px",
                    background: "rgba(255,255,255,0.12)",
                    border: "1px solid rgba(255,255,255,0.4)",
                    borderRadius: 12,
                    fontFamily: FONT,
                    fontSize: 14,
                    color: "#fff",
                    cursor: "pointer",
                  }}
                >
                  {fileSource === "camera" ? "Переснять" : "Выбрать другое"}
                </button>
                <button
                  type="button"
                  onClick={usePhoto}
                  style={{
                    flex: 1,
                    padding: "14px",
                    background: C.cherry,
                    border: "none",
                    borderRadius: 12,
                    fontFamily: FONT,
                    fontSize: 14,
                    fontWeight: 600,
                    color: C.white,
                    cursor: "pointer",
                  }}
                >
                  Использовать
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {saveSheet && (
        <SaveAsPhotoSheet
          {...saveSheet}
          onConfirm={() => {
            const f = previewFile;
            setSaveSheet(null);
            runOcr(f, true);
          }}
          onCancel={() => {
            setSaveSheet(null);
            setStep(null);
          }}
        />
      )}
    </div>
  );
}

function Donut({ title, data, num, sliceColor }) {
  const pal = [C.cherry, C.cherryM, "#C45558", "#E8A0A2", "#D4888A"];
  // sliceColor(d) — раскраска по группе (донат «Категории»); иначе вишнёвая палитра.
  const colorAt = (d, i) => (sliceColor ? sliceColor(d) : pal[i % pal.length]);
  const sectionTotal = data.reduce((s, d) => s + d.value, 0);
  return (
    <SectionCard title={title} num={num}>
      {data.length > 1 && (
        <div style={{ position: "relative", height: 160 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                cx="50%"
                cy="50%"
                innerRadius={54}
                outerRadius={75}
                paddingAngle={2}
                startAngle={90}
                endAngle={-270}
              >
                {data.map((d, i) => (
                  <Cell key={i} fill={colorAt(d, i)} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v) => fmt(v)}
                contentStyle={{
                  background: C.white,
                  border: `1px solid ${C.silver}`,
                  fontFamily: FONT,
                  fontSize: 11,
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <span style={{ fontSize: 11, color: "#636B7D", fontFamily: FONT }}>
              Итого
            </span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: C.dark,
                fontFamily: FONT,
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
            >
              {fmt(sectionTotal)}
            </span>
          </div>
        </div>
      )}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "6px 14px",
          padding: "8px 0 2px",
        }}
      >
        {data.map((d, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              whiteSpace: "nowrap",
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: pal[i % pal.length],
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 11, color: C.dark, fontFamily: FONT }}>
              {d.name}
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: C.gray,
                fontFamily: FONT,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {fmt(d.value)}
            </span>
          </div>
        ))}
      </div>
      {data.length === 0 && (
        <div
          style={{
            fontSize: 12,
            color: C.grayL,
            fontFamily: FONT,
            padding: "6px 0",
          }}
        >
          Нет данных за период
        </div>
      )}
    </SectionCard>
  );
}

// ─── PAGES ────────────────────────────────────────────────

function SvodkaPage({
  receipts,
  activePeriod,
  setActivePeriod,
  users,
  cards,
  catalog,
}) {
  const [showFilters, setShowFilters] = useState(false);
  const [selEmployee, setSelEmployee] = useState(null);
  const [cats, setCats] = useState([]);
  const [selCards, setSelCards] = useState([]);
  const filtersActive = !!selEmployee || cats.length > 0 || selCards.length > 0;

  const filtered = receipts.filter((r) => {
    if (!inPeriod(r.date, activePeriod)) return false;
    if (selEmployee && (r.employee || "Алексей Шукалович") !== selEmployee)
      return false;
    if (cats.length > 0 && !cats.includes(catName(r))) return false;
    if (selCards.length > 0 && !selCards.includes(r.payment)) return false;
    return true;
  });

  const total = filtered.reduce((s, r) => s + Number(r.amount), 0);
  const orgMap = {},
    payMap = {},
    catMap = {},
    empMap = {};
  filtered.forEach((r) => {
    if (!orgMap[r.org]) orgMap[r.org] = { value: 0, count: 0 };
    orgMap[r.org].value += Number(r.amount);
    orgMap[r.org].count++;
    if (!payMap[r.payment]) payMap[r.payment] = { value: 0, count: 0 };
    payMap[r.payment].value += Number(r.amount);
    payMap[r.payment].count++;
    const cn = catName(r);
    if (!catMap[cn]) catMap[cn] = { value: 0, count: 0 };
    catMap[cn].value += Number(r.amount);
    catMap[cn].count++;
    const e = r.employee || "Алексей Шукалович";
    if (!empMap[e]) empMap[e] = { value: 0, count: 0 };
    empMap[e].value += Number(r.amount);
    empMap[e].count++;
  });
  const catSorted = Object.entries(catMap).sort(
    (a, b) => b[1].value - a[1].value,
  );
  const topCat = catSorted[0];
  const subLine =
    topCat && total > 0
      ? `${Math.round((topCat[1].value / total) * 100)}% · ${topCat[0]}`
      : "Нет данных за период";
  const empData = Object.entries(empMap).map(([name, d]) => ({ name, ...d }));
  const pal = [C.cherry, C.cherryM, "#C45558", "#E8A0A2", "#D4888A"];

  return (
    <div style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 80px)" }}>
      <div
        style={{
          background: C.white,
          borderBottom: `1px solid ${C.silver}`,
          padding: "10px 16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <SegmentedControl
              segments={PERIOD_OPTIONS.map((o) => o.label)}
              active={periodLabel(activePeriod)}
              onChange={(l) => setActivePeriod(periodKey(l))}
            />
          </div>
          <div
            style={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <FilterIcon
              active={filtersActive}
              onClick={() => setShowFilters(true)}
            />
          </div>
        </div>
      </div>
      <div style={{ padding: "12px 16px" }}>
        <div
          style={{
            background: C.white,
            border: `1px solid ${C.silver}`,
            padding: "12px 16px",
            marginBottom: 10,
            borderLeft: "3px solid #A4161A",
            borderRadius: 6,
          }}
        >
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "#636B7D",
              marginBottom: 6,
              fontFamily: FONT,
            }}
          >
            Итого за период
          </div>
          <div
            style={{
              fontSize: 30,
              fontWeight: 700,
              color: "#111318",
              fontFamily: FONT,
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1.1,
              marginBottom: 4,
            }}
          >
            {fmt(total)}
          </div>
          <div style={{ fontSize: 12, color: "#636B7D", fontFamily: FONT }}>
            {subLine}
          </div>
        </div>
        <SectionCard title="Сотрудники">
          {empData.map((d, i) => (
            <div
              key={i}
              style={{
                height: 44,
                display: "flex",
                alignItems: "center",
                gap: 10,
                borderBottom:
                  i < empData.length - 1 ? `0.5px solid ${C.silver}` : "none",
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  background: pal[i % pal.length],
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 14,
                  fontWeight: 500,
                  color: C.dark,
                  fontFamily: FONT,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {d.name}
              </span>
              <span
                style={{
                  fontSize: 12,
                  color: "#636B7D",
                  fontFamily: FONT,
                  flexShrink: 0,
                }}
              >
                {d.count}
              </span>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#111318",
                  fontFamily: FONT,
                  fontVariantNumeric: "tabular-nums",
                  flexShrink: 0,
                }}
              >
                {fmt(d.value)}
              </span>
            </div>
          ))}
          {empData.length === 0 && (
            <div
              style={{
                fontSize: 12,
                color: C.grayL,
                fontFamily: FONT,
                padding: "10px 0",
              }}
            >
              Нет данных за период
            </div>
          )}
        </SectionCard>
        <Donut
          title="Организации"
          data={Object.entries(orgMap).map(([name, d]) => ({
            name: shortOrg(name),
            ...d,
          }))}
        />
        <Donut
          title="Методы оплаты"
          data={Object.entries(payMap).map(([name, d]) => ({ name, ...d }))}
        />
        <Donut
          title="Категории"
          data={Object.entries(catMap).map(([name, d]) => ({ name, ...d }))}
          sliceColor={(d) => catColor(d.name).fg}
        />
      </div>
      {showFilters && (
        <FiltersModal
          employees={users}
          selectedEmployee={selEmployee}
          catalog={catalog}
          cards={cards}
          selectedCats={cats}
          selectedCards={selCards}
          onApply={(r) => {
            setSelEmployee(r.employee);
            setCats(r.cats);
            setSelCards(r.cards);
          }}
          onReset={() => {
            setSelEmployee(null);
            setCats([]);
            setSelCards([]);
          }}
          onClose={() => setShowFilters(false)}
        />
      )}
    </div>
  );
}

function getCardLast4(raw) {
  if (!raw || typeof raw !== "object") return null;
  const candidates = [
    raw?.paymentType?.cardNumber,
    raw?.cardNumber,
    raw?.data?.json?.paymentType?.cardNumber,
    raw?.data?.json?.cardNumber,
    raw?.json?.paymentType?.cardNumber,
    raw?.json?.cardNumber,
  ];
  for (const v of candidates) {
    if (v == null) continue;
    const s = String(v).replace(/\D/g, "");
    if (s.length >= 4) return s.slice(-4);
  }
  return null;
}

function shortPayment(p) {
  if (!p) return "Не указано";
  if (p === "Корпоративная карта") return "Корп.карта";
  return p;
}

// Источник чека → короткая метка для индикатора в карточке.
const SOURCE_LABELS = {
  fns: "ФНС",
  qr_scan: "QR",
  photo_ocr: "Фото",
  manual: "Вручную",
};
const sourceLabel = (s) => SOURCE_LABELS[s] || null;

function SwipeableReceiptCard({ receipt, onClick, onDelete }) {
  const [tx, setTx] = useState(0);
  const [drag, setDrag] = useState(false); // render-safe mirror of dragging.current (no transition while dragging)
  const startX = useRef(0);
  const startY = useRef(0);
  const dragging = useRef(false);
  const moved = useRef(false);
  const locked = useRef(null);

  const r = receipt;
  const col = catColorById(r);
  const REVEAL = 72;
  const card4 = getCardLast4(r.raw_data);
  const payment = shortPayment(r.payment);

  function onPointerDown(e) {
    dragging.current = true;
    setDrag(true);
    moved.current = false;
    locked.current = null;
    startX.current = e.clientX;
    startY.current = e.clientY;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e) {
    if (!dragging.current) return;
    const dx = e.clientX - startX.current;
    const dy = e.clientY - startY.current;
    if (locked.current === null) {
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
        locked.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      } else return;
    }
    if (locked.current !== "x") return;
    moved.current = true;
    const base = tx < 0 ? -REVEAL : 0;
    const next = Math.min(0, Math.max(-REVEAL, base + dx));
    setTx(next);
  }
  function onPointerUp() {
    if (!dragging.current) return;
    dragging.current = false;
    setDrag(false);
    if (locked.current === "x") {
      setTx(tx < -REVEAL / 2 ? -REVEAL : 0);
    }
  }
  function handleTap() {
    if (moved.current) return;
    if (tx < 0) {
      setTx(0);
      return;
    }
    onClick?.();
  }

  return (
    <div
      style={{
        position: "relative",
        background: "#B91C1C",
        overflow: "hidden",
      }}
    >
      <div
        onClick={onDelete}
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: REVEAL,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
        }}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#fff"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6M14 11v6" />
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
        </svg>
      </div>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={handleTap}
        style={{
          background: C.white,
          padding: "11px 14px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          transform: `translateX(${tx}px)`,
          transition: drag ? "none" : "transform 0.2s ease",
          cursor: "pointer",
          userSelect: "none",
          touchAction: "pan-y",
        }}
      >
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: "50%",
            background: col.bg,
            color: col.fg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: FONT,
            fontSize: 15,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {orgInitial(r.org)}
        </div>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 4,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 14,
                fontFamily: FONT,
                color: C.dark,
                fontWeight: 600,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {shortOrg(r.org)}
            </span>
            <span
              style={{
                fontSize: 15,
                fontFamily: FONT,
                color: C.dark,
                fontWeight: 700,
                flexShrink: 0,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {fmt(r.amount)}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              color: "#636B7D",
              fontFamily: FONT,
              minWidth: 0,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <span
              style={{
                display: "inline-block",
                padding: "2px 8px",
                borderRadius: 20,
                background: col.bg,
                color: col.fg,
                fontSize: 10,
                fontWeight: 600,
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {catName(r)}
            </span>
            <span style={{ flexShrink: 0 }}>·</span>
            <span style={{ whiteSpace: "nowrap", flexShrink: 0 }}>
              {fmtDate(r.date)}
            </span>
            {sourceLabel(r.source) && (
              <span
                style={{
                  fontSize: 10,
                  color: "#636B7D",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                · {sourceLabel(r.source)}
              </span>
            )}
            <span style={{ flexShrink: 0 }}>·</span>
            <span
              style={{
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                minWidth: 0,
              }}
            >
              {payment}
              {card4 ? ` •••${card4}` : ""}
            </span>
            <span style={{ flex: 1 }} />
            <span
              style={{
                color: "#9CA3AF",
                fontSize: 20,
                fontWeight: 600,
                flexShrink: 0,
                lineHeight: 1,
              }}
            >
              ›
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReceiptDetailModal({
  receipt,
  onClose,
  onDelete,
  onChangeCategory,
  onChangePayment,
  catalog,
  paymentOptions = [],
}) {
  const [confirm, setConfirm] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const [showCategorySheet, setShowCategorySheet] = useState(false); // смена категории чека
  const r = receipt;
  const raw = r.raw_data || {};

  const inn = raw.userInn || raw.inn || "";
  const address = raw.retailPlaceAddress || raw.retailPlace || "";
  const place = raw.retailPlace || raw.retailPlaceAddress || "";
  const dateTime = raw.dateTime ? fmtDateTime(raw.dateTime * 1000) : "";
  const fdNum = raw.fiscalDocumentNumber || r.fd || "";
  const shift = raw.shiftNumber || "";
  const reqNum = raw.requestNumber || "";
  const items = Array.isArray(raw.items) ? raw.items : [];
  const totalSum = raw.totalSum ? raw.totalSum / 100 : Number(r.amount);
  const cashSum = raw.cashTotalSum ? raw.cashTotalSum / 100 : null;
  const cardSum = raw.ecashTotalSum ? raw.ecashTotalSum / 100 : null;
  const ndsSum = raw.nds18
    ? raw.nds18 / 100
    : raw.nds20
      ? raw.nds20 / 100
      : null;
  const ndsSum10 = raw.nds10 ? raw.nds10 / 100 : null;
  const taxKind =
    raw.appliedTaxationType !== undefined
      ? ["Общая", "УСН доход", "УСН доход-расход", "ЕНВД", "ЕСХН", "Патент"][
          raw.appliedTaxationType
        ] || String(raw.appliedTaxationType)
      : "";
  const kktReg = raw.kktRegId || "";
  const fnNum = raw.fiscalDriveNumber || r.kkt_fn || "";
  const fpd = raw.fiscalSign || r.fpd || "";

  const dashed = { borderTop: `1px dashed ${C.silver}`, margin: "8px 0" };
  const row = (label, value) =>
    value ? (
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
          padding: "3px 0",
          fontSize: 12,
          fontFamily: "'Courier New', Courier, monospace",
          color: C.dark,
        }}
      >
        <span style={{ color: C.gray }}>{label}</span>
        <span style={{ textAlign: "right", wordBreak: "break-all" }}>
          {value}
        </span>
      </div>
    ) : null;

  // Снимок карточки чека (контейнер receiptCardRef) в PNG через snapdom и
  // отправка системным «Поделиться». Захватывается только сама карточка —
  // блок кнопок (категория/карта/удаление) лежит вне ref, в кадр не попадает.
  const receiptCardRef = useRef(null);
  const [sharing, setSharing] = useState(false);
  async function handleShare() {
    const node = receiptCardRef.current;
    if (!node || sharing) return;
    setSharing(true);
    try {
      const scale = Math.min(window.devicePixelRatio || 1, 2); // не *2: бережём память на retina-мобильных
      const snap = await snapdom(node, {
        scale,
        backgroundColor: "#FFFEFB",
        embedFonts: true,
      });
      const canvas = await snap.toCanvas(); // через canvas — гарантированный PNG, без угадывания ключа опции snapdom
      const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
      const d = raw.dateTime
        ? new Date(raw.dateTime * 1000)
        : r.date
          ? new Date(r.date)
          : new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const datePart = `${pad(d.getDate())}-${pad(
        d.getMonth() + 1,
      )}-${d.getFullYear()}`;
      const amountPart = String(Math.round(totalSum || 0)).replace(
        /[^0-9]/g,
        "",
      );
      const filename = `receipt-${amountPart}-${datePart}.png`; // без кириллицы/спецсимволов
      const file = new File([blob], filename, { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      if (!(e && e.name === "AbortError")) {
        // AbortError = пользователь сам закрыл системный диалог
        console.error("receipt share failed", e);
        alert("Не удалось подготовить изображение чека");
      }
    } finally {
      setSharing(false);
    }
  }

  const dialogRef = useModalA11y(onClose);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(22,26,29,0.5)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 150,
      }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Детали документа"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.white,
          width: "100%",
          maxWidth: 480,
          maxHeight: "calc(100dvh - env(safe-area-inset-top) - 8px)",
          display: "flex",
          flexDirection: "column",
          borderRadius: "16px 16px 0 0",
          overflow: "hidden",
          outline: "none",
        }}
      >
        <div
          style={{
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: `1px solid ${C.silver}`,
            background: C.white,
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Назад"
            style={{
              border: "none",
              background: "none",
              color: C.dark,
              cursor: "pointer",
              fontSize: 20,
              padding: 4,
            }}
          >
            <span aria-hidden="true">‹</span>
          </button>
          <span
            style={{
              fontSize: 14,
              fontFamily: FONT,
              color: C.dark,
              fontWeight: 600,
            }}
          >
            Детали документа
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              onClick={handleShare}
              disabled={sharing}
              title="Поделиться"
              aria-label="Поделиться"
              style={{
                border: "none",
                background: "none",
                color: sharing ? C.grayL : C.dark,
                cursor: sharing ? "default" : "pointer",
                padding: 4,
                display: "flex",
                alignItems: "center",
              }}
            >
              <Share2 size={19} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрыть"
              style={{
                border: "none",
                background: "none",
                color: C.gray,
                cursor: "pointer",
                fontSize: 18,
                padding: 4,
              }}
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: "auto", background: "#FAF9F6" }}>
          <div
            ref={receiptCardRef}
            style={{
              margin: "14px 14px 8px",
              background: "#FFFEFB",
              border: `1px solid ${C.silver}`,
              padding: "18px 16px",
              fontFamily: "'Courier New', Courier, monospace",
              color: C.dark,
              boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
              borderRadius: 8,
            }}
          >
            <div
              style={{
                textAlign: "center",
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "0.15em",
                marginBottom: 8,
              }}
            >
              КАССОВЫЙ ЧЕК
            </div>
            {r.org && (
              <div
                style={{
                  textAlign: "center",
                  fontSize: 13,
                  fontWeight: 700,
                  marginBottom: 6,
                }}
              >
                {shortOrg(r.org)}
              </div>
            )}
            {address && (
              <div
                style={{
                  textAlign: "center",
                  fontSize: 11,
                  color: C.mid,
                  marginBottom: 2,
                }}
              >
                {address}
              </div>
            )}
            {place && place !== address && (
              <div
                style={{
                  textAlign: "center",
                  fontSize: 11,
                  color: C.mid,
                  marginBottom: 2,
                }}
              >
                {place}
              </div>
            )}
            {inn && (
              <div
                style={{
                  textAlign: "center",
                  fontSize: 11,
                  color: C.mid,
                  marginBottom: 6,
                }}
              >
                ИНН {inn}
              </div>
            )}
            <div style={dashed} />
            {row("Дата:", dateTime || fmtDate(r.date))}
            {row("Чек №:", fdNum)}
            {row("Смена №:", shift)}
            {row("Запрос №:", reqNum)}
            <div style={dashed} />
            <div
              style={{
                textAlign: "center",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.1em",
                margin: "4px 0",
              }}
            >
              ПРИХОД
            </div>
            <div style={dashed} />
            {items.length > 0 ? (
              items.map((it, i) => {
                const qty = it.quantity || 1;
                const price = (it.price || 0) / 100;
                const sum = (it.sum || 0) / 100;
                return (
                  <div key={i} style={{ padding: "4px 0", fontSize: 12 }}>
                    <div style={{ color: C.dark, marginBottom: 2 }}>
                      {i + 1}. {it.name || "—"}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        color: C.gray,
                        fontSize: 11,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      <span>
                        {qty} ×{" "}
                        {price.toLocaleString("ru-RU", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                      <span style={{ color: C.dark }}>
                        ={" "}
                        {sum.toLocaleString("ru-RU", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                    {it.nds !== undefined && (
                      <div style={{ fontSize: 10, color: C.grayL }}>
                        НДС: {it.nds}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div
                style={{
                  fontSize: 11,
                  color: C.gray,
                  textAlign: "center",
                  padding: "6px 0",
                }}
              >
                Состав чека недоступен
              </div>
            )}
            <div style={dashed} />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                fontSize: 14,
                fontWeight: 700,
                marginTop: 4,
              }}
            >
              <span>ИТОГО:</span>
              <span
                style={{ fontSize: 18, fontVariantNumeric: "tabular-nums" }}
              >
                {totalSum.toLocaleString("ru-RU", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{" "}
                ₽
              </span>
            </div>
            <div style={dashed} />
            {row(
              "НДС 20%:",
              ndsSum
                ? ndsSum.toLocaleString("ru-RU", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })
                : "",
            )}
            {row(
              "НДС 10%:",
              ndsSum10
                ? ndsSum10.toLocaleString("ru-RU", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })
                : "",
            )}
            {row(
              "Наличные:",
              cashSum !== null
                ? cashSum.toLocaleString("ru-RU", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })
                : "",
            )}
            {row(
              "Картой:",
              cardSum !== null
                ? cardSum.toLocaleString("ru-RU", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })
                : "",
            )}
            {row("Метод оплаты:", r.payment || "Не указано")}
            {(taxKind || kktReg || fnNum || fpd || fdNum) && (
              <div style={dashed} />
            )}
            {row("СНО:", taxKind)}
            {row("РН ККТ:", kktReg)}
            {row("ФН №:", fnNum)}
            {row("ФД №:", fdNum)}
            {row("ФПД:", fpd)}
          </div>

          <div
            style={{
              padding: "12px 14px calc(14px + env(safe-area-inset-bottom))",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <button
              onClick={() => {
                if (catalog && onChangeCategory) setShowCategorySheet(true);
              }}
              disabled={!catalog || !onChangeCategory}
              title="Сменить категорию"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "8px 10px",
                border: `1px solid ${C.silver}`,
                background: C.white,
                borderRadius: 10,
                fontFamily: FONT,
                cursor: catalog && onChangeCategory ? "pointer" : "default",
                textAlign: "left",
                WebkitTapHighlightColor: "rgba(164,22,26,0.08)",
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  padding: "4px 12px",
                  borderRadius: 20,
                  background: catColorById(r).bg,
                  color: catColorById(r).fg,
                  fontSize: 12,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {catName(r)}
              </span>
              {catGroupById(r) && (
                <span style={{ fontSize: 11, color: C.gray }}>
                  {catGroupById(r)}
                </span>
              )}
              <span style={{ flex: 1 }} />
              {catalog && onChangeCategory && (
                <span
                  style={{
                    color: C.grayL,
                    fontSize: 18,
                    flexShrink: 0,
                    lineHeight: 1,
                  }}
                >
                  ›
                </span>
              )}
            </button>
            {onChangePayment && (
              <button
                onClick={() => setShowPay(true)}
                style={{
                  padding: "12px 8px",
                  background: C.white,
                  border: `1px solid ${C.silver}`,
                  fontFamily: FONT,
                  fontSize: 13,
                  color: C.dark,
                  cursor: "pointer",
                  borderRadius: 10,
                  fontWeight: 600,
                }}
              >
                Изменить карту
              </button>
            )}
            {!confirm ? (
              <button
                onClick={() => setConfirm(true)}
                style={{
                  padding: "12px",
                  background: "#FEF2F2",
                  border: `1px solid #FECACA`,
                  fontFamily: FONT,
                  fontSize: 13,
                  color: "#B91C1C",
                  cursor: "pointer",
                  borderRadius: 10,
                  fontWeight: 600,
                }}
              >
                Удалить чек
              </button>
            ) : (
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setConfirm(false)}
                  style={{
                    flex: 1,
                    padding: "12px",
                    background: C.white,
                    border: `1px solid ${C.silver}`,
                    fontFamily: FONT,
                    fontSize: 13,
                    color: C.dark,
                    cursor: "pointer",
                    borderRadius: 10,
                  }}
                >
                  Отмена
                </button>
                <button
                  onClick={onDelete}
                  style={{
                    flex: 1,
                    padding: "12px",
                    background: "#B91C1C",
                    border: "none",
                    fontFamily: FONT,
                    fontSize: 13,
                    color: C.white,
                    cursor: "pointer",
                    borderRadius: 10,
                    fontWeight: 600,
                  }}
                >
                  Удалить
                </button>
              </div>
            )}
          </div>
        </div>

        {showPay && (
          <div
            onClick={() => setShowPay(false)}
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0,0,0,0.4)",
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
              zIndex: 10,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: C.white,
                width: "100%",
                borderRadius: "14px 14px 0 0",
                padding: "14px 0 calc(18px + env(safe-area-inset-bottom))",
                maxHeight: "60vh",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontFamily: FONT,
                  color: C.dark,
                  fontWeight: 700,
                  margin: "0 16px 10px",
                }}
              >
                Метод оплаты
              </div>
              <div style={{ overflow: "auto" }}>
                {paymentOptions.map((opt) => {
                  const sel = r.payment === opt;
                  return (
                    <button
                      key={opt}
                      onClick={() => {
                        onChangePayment(opt);
                        setShowPay(false);
                      }}
                      style={{
                        width: "100%",
                        padding: "13px 16px",
                        border: "none",
                        borderBottom: `0.5px solid ${C.silver}`,
                        background: sel ? C.cherryL : C.white,
                        color: sel ? C.cherry : C.dark,
                        fontFamily: FONT,
                        fontSize: 14,
                        cursor: "pointer",
                        textAlign: "left",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        fontWeight: sel ? 600 : 500,
                      }}
                    >
                      <span>{opt}</span>
                      {sel && (
                        <span style={{ color: C.cherry, fontSize: 16 }}>✓</span>
                      )}
                    </button>
                  );
                })}
                {paymentOptions.length === 0 && (
                  <div
                    style={{
                      padding: "20px 16px",
                      fontFamily: FONT,
                      fontSize: 12,
                      color: C.grayL,
                      textAlign: "center",
                    }}
                  >
                    Нет доступных карт
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {showCategorySheet && (
          <CategorySheet
            catalog={catalog}
            selected={catName(r)}
            onPick={onChangeCategory}
            onClose={() => setShowCategorySheet(false)}
          />
        )}
      </div>
    </div>
  );
}

function FiltersModal({
  dateBuilder,
  from,
  to,
  employees,
  selectedEmployee,
  catalog,
  selectedCats,
  cards,
  selectedCards,
  sources,
  onApply,
  onReset,
  onClose,
}) {
  const hasEmp = employees !== undefined;
  const hasCats = catalog != null && Array.isArray(catalog.groups);
  const hasCards = cards !== undefined;
  const hasSource = sources !== undefined;

  const [pFrom, setPFrom] = useState(from || monthStartISO());
  const [pTo, setPTo] = useState(to || todayISO());
  const [selEmp, setSelEmp] = useState(selectedEmployee || null);
  const [selCats, setSelCats] = useState(selectedCats || []);
  const [selCards, setSelCards] = useState(selectedCards || []);
  const [selSources, setSelSources] = useState(sources || []);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const toggleIn = (arr, setArr, val) => {
    if (val === null) {
      setArr([]);
      return;
    }
    setArr((prev) =>
      prev.includes(val) ? prev.filter((x) => x !== val) : [...prev, val],
    );
  };
  const isOn = (arr, val) =>
    val === null ? arr.length === 0 : arr.includes(val);

  // D1: двухуровневый фильтр категорий — группа разворачивается, чекбоксы на статьях,
  // «вся группа» одним тапом (вкл/выкл все имена статей группы). selCats = имена статей.
  const [expandedGroups, setExpandedGroups] = useState([]);
  const toggleExpand = (id) =>
    setExpandedGroups((p) =>
      p.includes(id) ? p.filter((x) => x !== id) : [...p, id],
    );
  const toggleGroupAll = (names) => {
    const allOn = names.length > 0 && names.every((n) => selCats.includes(n));
    setSelCats((prev) =>
      allOn
        ? prev.filter((n) => !names.includes(n))
        : [...new Set([...prev, ...names])],
    );
  };

  const inputStyle = {
    width: "100%",
    padding: "10px 12px",
    border: `1px solid ${C.silver}`,
    borderRadius: 8,
    fontSize: 13,
    fontFamily: FONT,
    color: C.dark,
    background: C.white,
    boxSizing: "border-box",
  };
  const labelStyle = {
    fontSize: 11,
    color: C.gray,
    fontFamily: FONT,
    marginBottom: 8,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
  };
  const chip = (on) => ({
    padding: "6px 12px",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: on ? 600 : 500,
    background: on ? "#A4161A" : "#EEF0F4",
    color: on ? "#fff" : "#636B7D",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  });

  const empName = (u) =>
    `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.email || "—";
  const cardNames = hasCards ? cards.map((c) => c.name).concat("Наличные") : [];

  const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
  const close = () => {
    setShown(false);
    setTimeout(onClose, 220);
  }; // play exit, then unmount
  const apply = () => {
    onApply({
      from: pFrom,
      to: pTo,
      employee: selEmp,
      cats: selCats,
      cards: selCards,
      sources: selSources,
    });
    close();
  };
  const reset = () => {
    onReset();
    close();
  };

  const dialogRef = useModalA11y(close);

  return (
    <div
      onClick={close}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.3)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 120,
        opacity: shown ? 1 : 0,
        transition: `opacity ${shown ? 280 : 220}ms ease`,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Фильтры"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.white,
          width: "100%",
          maxWidth: 480,
          borderRadius: "16px 16px 0 0",
          display: "flex",
          flexDirection: "column",
          maxHeight: "88dvh",
          paddingBottom: "env(safe-area-inset-bottom)",
          transform: shown ? "translateY(0)" : "translateY(100%)",
          transition: `transform ${shown ? 280 : 220}ms ${EASE}`,
          outline: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "8px 0 2px",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              background: "#D5D7DD",
            }}
          />
        </div>
        <div
          style={{
            padding: "4px 16px 12px",
            borderBottom: `1px solid ${C.silver}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 15,
              fontFamily: FONT,
              color: C.dark,
              fontWeight: 600,
            }}
          >
            Фильтры
          </span>
          <button
            type="button"
            onClick={close}
            aria-label="Закрыть"
            style={{
              border: "none",
              background: "none",
              color: C.gray,
              fontSize: 18,
              cursor: "pointer",
            }}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <div
          style={{
            padding: "16px",
            overflow: "auto",
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          {dateBuilder && (
            <div>
              <div style={labelStyle}>Период</div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 10,
                      color: C.gray,
                      fontFamily: FONT,
                      marginBottom: 4,
                    }}
                  >
                    От
                  </div>
                  <input
                    type="date"
                    value={pFrom}
                    onChange={(e) => setPFrom(e.target.value)}
                    aria-label="Период: дата от"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 10,
                      color: C.gray,
                      fontFamily: FONT,
                      marginBottom: 4,
                    }}
                  >
                    До
                  </div>
                  <input
                    type="date"
                    value={pTo}
                    onChange={(e) => setPTo(e.target.value)}
                    aria-label="Период: дата до"
                    style={inputStyle}
                  />
                </div>
              </div>
            </div>
          )}

          {hasEmp && (
            <div>
              <div style={labelStyle}>Сотрудник</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {[
                  ["Все сотрудники", null],
                  ...employees.map((u) => [empName(u), empName(u)]),
                ].map(([label, val]) => (
                  <button
                    key={val || "all"}
                    onClick={() => setSelEmp(val)}
                    style={chip(val === null ? !selEmp : selEmp === val)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {hasCats && (
            <div>
              <div style={labelStyle}>Категория</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div>
                  <button
                    onClick={() => setSelCats([])}
                    style={chip(selCats.length === 0)}
                  >
                    Все
                  </button>
                </div>
                {catalog.groups.map((g) => {
                  const names = (g.categories || []).map((c) => c.name);
                  const allOn =
                    names.length > 0 && names.every((n) => selCats.includes(n));
                  const someOn =
                    !allOn && names.some((n) => selCats.includes(n));
                  const col = groupColor(g.name);
                  const expanded = expandedGroups.includes(g.id);
                  return (
                    <div
                      key={g.id}
                      style={{
                        border: `1px solid ${C.silver}`,
                        borderRadius: 10,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "8px 10px",
                        }}
                      >
                        <button
                          onClick={() => toggleGroupAll(names)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            flex: 1,
                            border: "none",
                            background: "none",
                            cursor: "pointer",
                            textAlign: "left",
                            padding: 0,
                          }}
                        >
                          <span
                            style={{
                              width: 18,
                              height: 18,
                              borderRadius: 5,
                              border: `1.5px solid ${
                                allOn || someOn ? col.fg : C.silver
                              }`,
                              background: allOn
                                ? col.fg
                                : someOn
                                  ? col.bg
                                  : C.white,
                              color: allOn ? "#fff" : col.fg,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                              fontSize: 12,
                              fontWeight: 700,
                            }}
                          >
                            {allOn ? "✓" : someOn ? "–" : ""}
                          </span>
                          <span
                            style={{
                              fontSize: 13,
                              fontFamily: FONT,
                              color: C.dark,
                              fontWeight: 600,
                            }}
                          >
                            {g.name}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleExpand(g.id)}
                          aria-label={
                            expanded ? "Свернуть группу" : "Развернуть группу"
                          }
                          style={{
                            border: "none",
                            background: "none",
                            cursor: "pointer",
                            color: C.gray,
                            fontSize: 16,
                            padding: "2px 6px",
                            transform: expanded ? "rotate(90deg)" : "none",
                            transition: "transform 0.15s",
                          }}
                        >
                          <span aria-hidden="true">›</span>
                        </button>
                      </div>
                      {expanded && (
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 6,
                            padding: "0 10px 10px 36px",
                          }}
                        >
                          {(g.categories || []).map((c) => (
                            <button
                              key={c.id}
                              onClick={() =>
                                toggleIn(selCats, setSelCats, c.name)
                              }
                              style={chip(selCats.includes(c.name))}
                            >
                              {c.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {hasCards && (
            <div>
              <div style={labelStyle}>Карта</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {[
                  ["Все", null],
                  ...cardNames.map((n) => [shortPayment(n), n]),
                ].map(([label, val]) => (
                  <button
                    key={val || "all"}
                    onClick={() => toggleIn(selCards, setSelCards, val)}
                    style={chip(isOn(selCards, val))}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {hasSource && (
            <div>
              <div style={labelStyle}>Источник</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {[
                  ["Все", null],
                  ["ФНС", "fns"],
                  ["QR", "qr_scan"],
                  ["Фото", "photo_ocr"],
                  ["Вручную", "manual"],
                ].map(([label, val]) => (
                  <button
                    key={label}
                    onClick={() => toggleIn(selSources, setSelSources, val)}
                    style={chip(isOn(selSources, val))}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div
          style={{
            padding: "12px 16px",
            display: "flex",
            gap: 8,
            borderTop: `1px solid ${C.silver}`,
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={reset}
            title="Сбросить"
            aria-label="Сбросить"
            style={{
              width: 44,
              height: 44,
              border: `1px solid ${C.silver}`,
              background: C.white,
              color: C.gray,
              cursor: "pointer",
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
          </button>
          <button
            onClick={apply}
            style={{
              flex: 1,
              padding: "12px",
              background: C.cherry,
              border: "none",
              fontFamily: FONT,
              fontSize: 13,
              color: C.white,
              cursor: "pointer",
              borderRadius: 10,
              fontWeight: 600,
              letterSpacing: "0.04em",
            }}
          >
            Применить
          </button>
        </div>
      </div>
    </div>
  );
}

function FilterIcon({ active, onClick, size = 38 }) {
  const stroke = active ? C.cherry : "#636B7D";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Фильтры"
      aria-pressed={active}
      style={{
        position: "relative",
        width: size,
        height: size,
        border: "none",
        background: active ? C.cherryL : "#EEF0F4",
        cursor: "pointer",
        borderRadius: 10,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M2 4h12M4 8h8M6 12h4"
          stroke={stroke}
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      {active && (
        <span
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: C.cherry,
            border: "1.5px solid #fff",
          }}
        />
      )}
    </button>
  );
}

// Compact period picker pill with a dropdown — Operacii header.
// Mounts fresh on open, so the rAF flip plays the scale/opacity intro.
function PeriodMenu({ value, onChange, onClose }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 90 }}
      />
      <div
        style={{
          position: "absolute",
          top: "calc(100% + 4px)",
          right: 0,
          zIndex: 91,
          background: C.white,
          border: `1px solid ${C.silver}`,
          borderRadius: 10,
          boxShadow: "0 8px 24px rgba(0,0,0,0.14)",
          overflow: "hidden",
          minWidth: 130,
          opacity: shown ? 1 : 0,
          transform: shown ? "scale(1)" : "scale(0.95)",
          transformOrigin: "top right",
          transition: "opacity 150ms ease, transform 150ms ease",
        }}
      >
        {PERIOD_OPTIONS.map((o) => (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "10px 14px",
              border: "none",
              background: value === o.key ? C.cherryL : C.white,
              color: value === o.key ? C.cherry : C.dark,
              fontFamily: FONT,
              fontSize: 13,
              cursor: "pointer",
              fontWeight: value === o.key ? 600 : 400,
              whiteSpace: "nowrap",
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </>
  );
}

function PeriodPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "9px 12px",
          background: "#EEF0F4",
          border: "none",
          borderRadius: 8,
          fontFamily: FONT,
          fontSize: 13,
          color: "#111318",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {periodLabel(value)}
        <span style={{ fontSize: 9, opacity: 0.55 }}>▾</span>
      </button>
      {open && (
        <PeriodMenu
          value={value}
          onChange={(k) => {
            onChange(k);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

// Транзитное уведомление сверху по центру (задача №9 фаза D). type: success
// (зелёный) / warning (янтарный) / error (красный). Авто-скрытие — в OperaciiPage.
function Toast({ toast }) {
  if (!toast) return null;
  const palette = {
    success: { bg: "#F0FDF4", fg: "#15803D", bd: "#BBF7D0" },
    warning: { bg: "#FFFBEB", fg: "#B45309", bd: "#FDE68A" },
    error: { bg: "#FEF2F2", fg: "#B91C1C", bd: "#FECACA" },
  }[toast.type] || { bg: "#F0FDF4", fg: "#15803D", bd: "#BBF7D0" };
  return (
    <div
      style={{
        position: "fixed",
        top: "calc(env(safe-area-inset-top) + 8px)",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 200,
        background: palette.bg,
        border: `1px solid ${palette.bd}`,
        color: palette.fg,
        borderRadius: 10,
        padding: "10px 16px",
        fontFamily: FONT,
        fontSize: 12,
        fontWeight: 600,
        maxWidth: "90vw",
        textAlign: "center",
        boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
      }}
    >
      {toast.message}
    </div>
  );
}

// Интерактивный sticky-баннер дублей (задача №9 фаза D): список всех похожих
// чеков (warning.duplicates) с чекбоксами и массовым удалением. Умные defaults:
// отмечены только deletable (kkt_fn IS NULL) и не в отчёте; ФНС/QR (deletable=
// false) и in_report — disabled с пометкой. force в UI всегда false (бэк защищает).
function DuplicateWarningBanner({ warning, onDelete, onClose }) {
  const dups = warning.duplicates || [];
  const high = warning.confidence === "high";
  const headOrg =
    (dups.find((d) => !d.is_new && d.org) || dups[0] || {}).org || "";
  const [selected, setSelected] = useState(
    () =>
      new Set(dups.filter((d) => d.deletable && !d.in_report).map((d) => d.id)),
  );
  const [busy, setBusy] = useState(false);
  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const count = selected.size;
  const submit = async () => {
    if (count === 0 || busy) return;
    setBusy(true);
    const ok = await onDelete([...selected]); // на успехе баннер размонтируется
    if (!ok) setBusy(false); // на ошибке — остаёмся, кнопка снова активна
  };
  const disabledBtn = count === 0 || busy;
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        margin: "10px 16px 0",
        padding: "12px",
        background: "#FFFBEB",
        border: "1px solid #FDE68A",
        borderRadius: 8,
        fontFamily: FONT,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <AlertTriangle
          size={16}
          color="#B45309"
          strokeWidth={2}
          style={{ flexShrink: 0, marginTop: 1 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#B45309" }}>
            {high && headOrg
              ? `Возможный дубль чека «${headOrg}»`
              : "Возможный дубль"}
          </div>
          <div style={{ fontSize: 11, color: "#B45309", marginTop: 1 }}>
            Найдено {dups.length}{" "}
            {plural(dups.length, [
              "похожий чек",
              "похожих чека",
              "похожих чеков",
            ])}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Закрыть"
          style={{
            background: "none",
            border: "none",
            padding: 0,
            color: "#B45309",
            fontSize: 16,
            lineHeight: 1,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          ×
        </button>
      </div>
      <div
        style={{
          marginTop: 10,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {dups.map((d) => {
          const locked = !d.deletable || d.in_report;
          return (
            <label
              key={d.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 8px",
                background: C.white,
                border: `1px solid ${C.silver}`,
                borderRadius: 8,
                cursor: locked ? "default" : "pointer",
                opacity: locked ? 0.7 : 1,
              }}
            >
              <input
                type="checkbox"
                disabled={locked}
                checked={selected.has(d.id)}
                onChange={() => toggle(d.id)}
                aria-label="Выбрать дубликат"
                style={{
                  width: 16,
                  height: 16,
                  accentColor: C.cherry,
                  cursor: locked ? "default" : "pointer",
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: "0.03em",
                  color: C.mid,
                  background: C.lightGray,
                  border: `1px solid ${C.silver}`,
                  borderRadius: 5,
                  padding: "1px 6px",
                  flexShrink: 0,
                }}
              >
                {SRC_LABEL[d.source] || d.source}
              </span>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 12,
                  color: C.dark,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {(d.org ? d.org + " · " : "") +
                  fmt(d.amount) +
                  " · " +
                  fmtDate(d.date)}
              </span>
              {d.is_new && (
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: "#B45309",
                    background: "#FFFBEB",
                    border: "1px solid #FDE68A",
                    borderRadius: 5,
                    padding: "1px 5px",
                    flexShrink: 0,
                  }}
                >
                  новый
                </span>
              )}
              {d.in_report && (
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 600,
                    color: "#6D28D9",
                    background: "#F5F3FF",
                    border: "1px solid #DDD6FE",
                    borderRadius: 5,
                    padding: "1px 5px",
                    flexShrink: 0,
                  }}
                >
                  В отчёте
                </span>
              )}
              {!d.deletable && (
                <Lock
                  size={13}
                  color={C.gray}
                  strokeWidth={2}
                  style={{ flexShrink: 0 }}
                />
              )}
            </label>
          );
        })}
      </div>
      <div
        style={{
          marginTop: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <button
          onClick={submit}
          disabled={disabledBtn}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 14px",
            border: "none",
            borderRadius: 8,
            fontFamily: FONT,
            fontSize: 12,
            fontWeight: 700,
            cursor: disabledBtn ? "default" : "pointer",
            background: disabledBtn ? C.silver : C.cherry,
            color: disabledBtn ? C.gray : C.white,
          }}
        >
          <Trash2 size={14} strokeWidth={2} /> Удалить выбранные ({count})
        </button>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            padding: "8px 6px",
            color: C.mid,
            fontFamily: FONT,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Закрыть
        </button>
      </div>
    </div>
  );
}

// D1: bottom-sheet выбора статьи — группы (цвет+подпись) + статьи + поиск.
// Single-select: возвращает ИМЯ выбранной статьи (бэк резолвит в category_id).
function CategorySheet({ catalog, selected, onPick, onClose }) {
  const [shown, setShown] = useState(false);
  const [q, setQ] = useState("");
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
  const close = () => {
    setShown(false);
    setTimeout(onClose, 220);
  };
  const pick = (name) => {
    onPick(name);
    close();
  };
  const ql = q.trim().toLowerCase();
  const visGroups = (catalog?.groups || [])
    .map((g) => ({
      ...g,
      cats: (g.categories || []).filter(
        (c) =>
          c.is_visible !== false && (!ql || c.name.toLowerCase().includes(ql)),
      ),
    }))
    .filter((g) => g.cats.length > 0);
  const dialogRef = useModalA11y(close);
  return (
    <div
      onClick={close}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.3)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 160,
        opacity: shown ? 1 : 0,
        transition: `opacity ${shown ? 280 : 220}ms ease`,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Категория"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.white,
          width: "100%",
          maxWidth: 480,
          borderRadius: "16px 16px 0 0",
          display: "flex",
          flexDirection: "column",
          maxHeight: "88dvh",
          paddingBottom: "env(safe-area-inset-bottom)",
          transform: shown ? "translateY(0)" : "translateY(100%)",
          transition: `transform ${shown ? 280 : 220}ms ${EASE}`,
          outline: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "8px 0 2px",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              background: "#D5D7DD",
            }}
          />
        </div>
        <div
          style={{
            padding: "4px 16px 12px",
            borderBottom: `1px solid ${C.silver}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 15,
              fontFamily: FONT,
              color: C.dark,
              fontWeight: 600,
            }}
          >
            Категория
          </span>
          <button
            type="button"
            onClick={close}
            aria-label="Закрыть"
            style={{
              border: "none",
              background: "none",
              color: C.gray,
              fontSize: 18,
              cursor: "pointer",
            }}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <div style={{ padding: "10px 16px 6px", flexShrink: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              border: `1px solid #EEF0F4`,
              padding: "8px 12px",
              gap: 8,
              background: "#F6F7F9",
              borderRadius: 10,
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke={C.grayL}
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск статьи…"
              aria-label="Поиск статьи"
              style={{
                border: "none",
                outline: "none",
                flex: 1,
                minWidth: 0,
                fontSize: 13,
                background: "none",
                fontFamily: FONT,
                color: C.dark,
              }}
            />
          </div>
        </div>
        <div style={{ padding: "6px 0 12px", overflow: "auto", flex: 1 }}>
          {visGroups.map((g) => {
            const col = groupColor(g.name);
            return (
              <div key={g.id} style={{ marginBottom: 4 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 16px 4px",
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: col.fg,
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: C.gray,
                      fontFamily: FONT,
                    }}
                  >
                    {g.name}
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                    padding: "2px 16px 6px",
                  }}
                >
                  {g.cats.map((c) => {
                    const sel = selected === c.name;
                    return (
                      <button
                        key={c.id}
                        onClick={() => pick(c.name)}
                        style={{
                          padding: "7px 12px",
                          border: `1px solid ${sel ? col.fg : C.silver}`,
                          background: sel ? col.bg : C.white,
                          color: sel ? col.fg : C.dark,
                          fontFamily: FONT,
                          fontSize: 12,
                          cursor: "pointer",
                          borderRadius: 8,
                          fontWeight: sel ? 700 : 500,
                        }}
                      >
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {visGroups.length === 0 && (
            <div
              style={{
                padding: "24px 16px",
                textAlign: "center",
                fontSize: 13,
                color: C.grayL,
                fontFamily: FONT,
              }}
            >
              Ничего не найдено
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Виды операции для поля n= в QR-строке (как в приложении ФНС).
const OP_TYPES = [
  { n: "1", label: "Приход" },
  { n: "2", label: "Возврат прихода" },
  { n: "3", label: "Расход" },
  { n: "4", label: "Возврат расхода" },
];

// Ручной ввод реквизитов чека (ФН/ФД/ФПД + сумма/дата+время/тип) с проверкой
// через ФНС. Собирает QR-строку (buildQRString) и прогоняет через тот же
// onVerify=handleCapture, что и скан: 'ok' → форма уже заполнена и открыта;
// иначе — фолбэк «записать без проверки» (source=manual).
function RequisitesSheet({ prefill, onClose, onVerify, onManualFallback }) {
  const now = new Date();
  const pad = (x) => String(x).padStart(2, "0");
  const [date, setDate] = useState(
    prefill?.date ||
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
  );
  const [time, setTime] = useState(
    `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  );
  const [opType, setOpType] = useState(prefill?.type || "1");
  const [amount, setAmount] = useState(prefill?.amount || "");
  const [fn, setFn] = useState(prefill?.fn || "");
  const [fd, setFd] = useState(prefill?.fd || "");
  const [fpd, setFpd] = useState(prefill?.fpd || "");
  const [checking, setChecking] = useState(false);
  const [errMsg, setErrMsg] = useState(""); // сообщение фолбэка после неуспешной проверки
  const [showInfo, setShowInfo] = useState(false); // тултип ⓘ (молчит до тапа)
  const [nowMs] = useState(() => Date.now()); // «сейчас» на момент открытия формы — стабильно между рендерами

  const num = (v) => /^\d+([.,]\d+)?$/.test(String(v).trim());
  const fnDigits = fn.replace(/\D/g, "");
  const fnHint = fn && fnDigits.length !== 16; // не блокирует, только подсказка
  const future =
    date && time ? new Date(`${date}T${time}`).getTime() > nowMs : false;
  const canCheck = !!(
    date &&
    time &&
    num(amount) &&
    /^\d+$/.test(fn.trim()) &&
    /^\d+$/.test(fd.trim()) &&
    /^\d+$/.test(fpd.trim()) &&
    !future
  );

  async function check() {
    if (checking || !canCheck) return;
    setErrMsg("");
    setChecking(true);
    const qr = buildQRString({ date, time, amount, fn, fd, fpd, opType }); // fn/fd/fpd НЕ логируем
    let result;
    try {
      result = await onVerify(qr);
    } catch {
      result = "partial";
    }
    setChecking(false);
    if (result === "ok") {
      onClose();
      return;
    } // handleCapture уже открыл форму
    if (result === "not_found")
      setErrMsg(
        "Чек не найден в базе ФНС. Проверьте реквизиты или запишите без проверки.",
      );
    else if (result === "unavailable")
      setErrMsg(
        "Сервис ФНС временно недоступен. Попробуйте позже или запишите без проверки.",
      );
    else
      setErrMsg(
        "Не удалось проверить чек. Попробуйте снова или запишите без проверки.",
      );
  }

  const lbl = {
    fontSize: 9,
    letterSpacing: "0.18em",
    textTransform: "uppercase",
    color: C.gray,
    fontFamily: FONT,
  };
  const inp = {
    width: "100%",
    border: "none",
    borderBottom: `1.5px solid ${C.silver}`,
    outline: "none",
    padding: "7px 0",
    fontSize: 13,
    fontFamily: FONT,
    color: C.dark,
    background: "transparent",
    boxSizing: "border-box",
  };
  const amber = {
    marginTop: 6,
    padding: "6px 10px",
    background: "#FFFBEB",
    border: "1px solid #FDE68A",
    borderRadius: 8,
    fontFamily: FONT,
    fontSize: 11,
    color: "#B45309",
  };
  const fallbackBtn = {
    width: "100%",
    marginTop: 8,
    padding: "10px",
    background: "none",
    border: "none",
    fontFamily: FONT,
    fontSize: 12,
    color: C.gray,
    cursor: "pointer",
    textDecoration: "underline",
  };

  return (
    <Modal
      title="Ввести реквизиты"
      onClose={onClose}
      footer={
        <>
          {errMsg && (
            <div
              style={{
                marginBottom: 8,
                padding: "8px 12px",
                background: "#FEF2F2",
                border: "1px solid #FECACA",
                borderRadius: 8,
                fontFamily: FONT,
                fontSize: 12,
                color: "#B91C1C",
              }}
            >
              {errMsg}
            </div>
          )}
          <Btn full onClick={check} disabled={!canCheck} loading={checking}>
            {checking ? "Проверяем…" : "Проверить чек"}
          </Btn>
          <button
            onClick={() => onManualFallback({ date, amount })}
            style={fallbackBtn}
          >
            {errMsg
              ? "Записать без проверки"
              : "Чека нет в базе ФНС? Записать без проверки"}
          </button>
        </>
      }
    >
      <div style={{ paddingTop: 12 }}>
        <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={{ ...lbl, marginBottom: 4 }}>Дата</div>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-label="Дата чека"
              style={inp}
            />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ ...lbl, marginBottom: 4 }}>Время</div>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              aria-label="Время чека"
              style={inp}
            />
          </div>
        </div>
        {future && (
          <div style={{ ...amber, marginTop: -8, marginBottom: 12 }}>
            Дата и время чека не могут быть в будущем
          </div>
        )}

        <div style={{ marginBottom: 14 }}>
          <div style={{ ...lbl, marginBottom: 4 }}>Тип операции</div>
          <select
            value={opType}
            onChange={(e) => setOpType(e.target.value)}
            style={{ ...inp, appearance: "none", cursor: "pointer" }}
          >
            {OP_TYPES.map((o) => (
              <option key={o.n} value={o.n}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <RuleInput
          label="Итого, ₽"
          value={amount}
          onChange={setAmount}
          type="number"
          placeholder="0.00"
        />

        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 4,
            }}
          >
            <span style={lbl}>ФН (фискальный накопитель)</span>
            <button
              onClick={() => setShowInfo((s) => !s)}
              aria-label="Подсказка"
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                border: `1px solid ${C.grayL}`,
                background: "none",
                color: C.gray,
                fontSize: 11,
                lineHeight: 1,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                padding: 0,
              }}
            >
              i
            </button>
          </div>
          <input
            value={fn}
            onChange={(e) => setFn(e.target.value)}
            inputMode="numeric"
            placeholder="16 цифр"
            aria-label="ФН (фискальный накопитель)"
            style={inp}
          />
          {showInfo && (
            <div
              style={{
                marginTop: 6,
                padding: "8px 10px",
                background: C.lightGray,
                borderRadius: 8,
                fontFamily: FONT,
                fontSize: 11,
                color: C.mid,
                lineHeight: 1.5,
              }}
            >
              Эти числа напечатаны внизу чека, рядом с QR-кодом. ФН — фискальный
              накопитель (16 цифр), ФД — номер документа, ФПД — фискальный
              признак.
            </div>
          )}
          {fnHint && <div style={amber}>Обычно ФН — 16 цифр, проверьте</div>}
        </div>

        <RuleInput
          label="ФД № (фискальный документ)"
          value={fd}
          onChange={setFd}
          type="text"
          placeholder="например 12345"
        />
        <RuleInput
          label="ФПД (фискальный признак)"
          value={fpd}
          onChange={setFpd}
          type="text"
          placeholder="например 1234567890"
        />
      </div>
    </Modal>
  );
}

function OperaciiPage({
  receipts,
  cards,
  catalog,
  handleAdd,
  handleDelete,
  handleUpdate,
  handleBulkDelete,
  activePeriod,
  setActivePeriod,
}) {
  const paymentOptions = [
    ...cards.map((c) => c.name),
    "Наличные",
    "Не указано",
  ];
  const [search, setSearch] = useState("");
  const [sources, setSources] = useState([]); // [] = «Все»
  const [cats, setCats] = useState([]); // выбранные категории, [] = «Все»
  const [selCards, setSelCards] = useState([]); // выбранные карты (по полю payment), [] = «Все»
  const [showFilters, setShowFilters] = useState(false);
  const defaultFrom = "",
    defaultTo = "";
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(defaultTo);
  const [limit, setLimit] = useState(30);
  const [showScan, setShowScan] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showReq, setShowReq] = useState(false); // экран ручного ввода реквизитов (проверка ФНС)
  const [reqPrefill, setReqPrefill] = useState(null); // парсинг QR при заходе с неудачного скана
  const [showCatSheet, setShowCatSheet] = useState(false); // D1: bottom-sheet выбора статьи
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState({
    org: "",
    amount: "",
    category: "Не указано",
    payment: "Не указано",
    date: todayISO(),
    fn: "",
    raw_data: null,
    source: "manual",
  });
  const [fnsStatus, setFnsStatus] = useState(null); // null | "loading" | "ok" | "partial"
  const [isSubmitting, setIsSubmitting] = useState(false); // POST /receipts in flight — blocks double-submit
  const [addError, setAddError] = useState(""); // red banner above the submit button
  const [dupId, setDupId] = useState(null); // on 409: id of the receipt that already exists
  const [dupWarning, setDupWarning] = useState(null); // on 200+warning: дубль(и) (задача №9)
  const [toast, setToast] = useState(null); // {type,message,duration} — уведомление
  // Баннер дубля теперь sticky без авто-скрытия (фаза D). Авто-скрываем только
  // toast; cleanup снимает таймер при смене сообщения/размонтировании страницы.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.duration || 3000);
    return () => clearTimeout(t);
  }, [toast]);
  // In-flight FNS prefetch keyed by qrText, started the instant the modal
  // captures a QR (before the user taps "Загрузить чек"). By the time the
  // user confirms, the network round-trip is usually already done.
  const fnsPrefetchRef = useRef({ qrText: null, promise: null });

  async function _fetchFns(qrText) {
    // Surface the HTTP status so callers can tell ok (200) / not_found (404) /
    // unavailable (503) apart. httpStatus 0 = transport failure → unavailable.
    try {
      const res = await authFetch(`/api/fns/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qr_raw: qrText }),
      });
      const body = await res.json().catch(() => null);
      return { httpStatus: res.status, body };
    } catch {
      /* network failure or timeout */
    }
    return { httpStatus: 0, body: null };
  }

  // Called by the modal as soon as it captures a QR. Fire-and-forget — the
  // result is consumed later by handleCapture via the shared ref.
  function prefetchFns(qrText) {
    if (!qrText) return;
    if (
      fnsPrefetchRef.current.qrText === qrText &&
      fnsPrefetchRef.current.promise
    )
      return;
    fnsPrefetchRef.current = { qrText, promise: _fetchFns(qrText) };
  }

  async function _suggestPayment(org) {
    if (!org) return null;
    try {
      const sres = await authFetch(
        `/api/receipts/suggest-payment?org=${encodeURIComponent(org)}`,
      );
      if (sres.ok) {
        const sd = await sres.json();
        return sd.payment || null;
      }
    } catch {
      /* ignored */
    }
    return null;
  }

  // Two-phase contract with ScanReceiptModal:
  //   1. Modal captures the QR locally, calls prefetchFns(), shows preview.
  //   2. User confirms → modal calls handleCapture(qrText) → we await the
  //      prefetched FNS promise (or start one fresh as fallback).
  //      Return 'ok' → modal closes itself, form is already open with full data.
  //      Return 'partial' → modal switches to its own error screen; user can
  //      rescan, fall back to OCR (handleOcrFile), or manual (handleManual).
  async function handleCapture(qrText) {
    const parsed = parseQRString(qrText);
    // Prefill form from local QR parse — reliable even when FNS fails.
    setForm((p) => ({
      ...p,
      date: parsed.date || p.date,
      amount: parsed.amount || "",
      org: "",
      category: "Не указано",
      fn: parsed.fn || "",
      raw_data: null,
      source: "qr_scan",
    }));
    setFnsStatus("loading");

    let d;
    if (
      fnsPrefetchRef.current.qrText === qrText &&
      fnsPrefetchRef.current.promise
    ) {
      d = await fnsPrefetchRef.current.promise;
    } else {
      d = await _fetchFns(qrText);
    }
    fnsPrefetchRef.current = { qrText: null, promise: null };

    // Distinguish the FNS outcomes by HTTP status (see fns.py): 404 not_found,
    // 503/0 unavailable, anything else without an ok body → partial.
    const { httpStatus, body } = d || {};
    if (httpStatus === 404) {
      setFnsStatus("partial");
      return "not_found";
    }
    if (httpStatus === 503 || httpStatus === 0) {
      setFnsStatus("partial");
      return "unavailable";
    }
    if (httpStatus !== 200 || !body || body.status !== "ok" || !body.org) {
      setFnsStatus("partial");
      return "partial";
    }

    const raw = body.raw || {};
    const cash = Number(raw.cashTotalSum) || 0;
    const card = Number(raw.ecashTotalSum) || 0;
    const suggested = await _suggestPayment(body.org);
    const defaultCard = cards.find((c) => c.is_default)?.name || null;
    let payment = "Не указано";
    if (cash > 0 && card === 0) payment = "Наличные";
    else if (card > 0 && cash === 0)
      payment =
        suggested && suggested !== "Наличные"
          ? suggested
          : defaultCard || "Не указано";
    else if (suggested) payment = suggested;

    setForm((p) => ({
      ...p,
      org: body.org || p.org,
      amount: body.total ? String(body.total) : p.amount,
      category: body.category || p.category,
      raw_data: body.raw || body,
      payment,
    }));
    setShowAdd(true);
    setFnsStatus("ok");
    setTimeout(() => setFnsStatus((s) => (s === "ok" ? null : s)), 1500);
    return "ok";
  }

  // OCR fallback: when FNS comes back partial, the modal offers a "Распознать
  // фото" button → file picker → this handler. Returns 'ok'/'partial' with the
  // same contract as handleCapture, so the modal closes itself on success.
  async function handleOcrFile(file) {
    if (!file) return "partial";
    setFnsStatus("loading");
    const fd = new FormData();
    fd.append("file", file);
    let d = null;
    try {
      // Vision OCR is slower than the FNS/payment calls — allow 20s.
      const res = await authFetch(
        `/api/receipts/ocr/`,
        { method: "POST", body: fd },
        20000,
      );
      if (res.ok) d = await res.json().catch(() => null);
    } catch {
      /* network or timeout */
    }

    if (!d || !d.org || d.amount == null) {
      setFnsStatus("partial");
      return "partial";
    }

    const suggested = await _suggestPayment(d.org);
    const defaultCard = cards.find((c) => c.is_default)?.name || null;
    let payment = "Не указано";
    if (d.payment_type === "cash") payment = "Наличные";
    else if (d.payment_type === "card")
      payment =
        suggested && suggested !== "Наличные"
          ? suggested
          : defaultCard || "Не указано";
    else if (suggested) payment = suggested;

    setForm((p) => ({
      ...p,
      org: d.org,
      amount: String(d.amount),
      date: d.date || p.date,
      category: d.category || "Не указано",
      fn: d.fn || p.fn,
      raw_data: d,
      payment,
      source: "photo_ocr",
    }));
    setShowAdd(true);
    setFnsStatus("ok");
    setTimeout(() => setFnsStatus((s) => (s === "ok" ? null : s)), 1500);
    return "ok";
  }

  // «Ввести вручную» / «Заполнить вручную» → экран ввода реквизитов с проверкой ФНС.
  // qrText (опц.) — из фазы fnsError скана: префиллим реквизиты распарсенным QR,
  // чтобы пользователь дозаполнил только время и перепроверил.
  function handleManual(qrText) {
    setShowScan(false);
    setReqPrefill(qrText ? parseQRString(qrText) : null);
    setShowReq(true);
  }

  // Фолбэк «записать без проверки» из RequisitesSheet → старая форма «Добавить чек»,
  // source=manual, переносим введённые дату/сумму.
  function openManualForm(prefill) {
    setShowReq(false);
    setForm((p) => ({
      ...p,
      date: prefill?.date || p.date,
      amount: prefill?.amount || "",
      org: "",
      category: "Не указано",
      fn: "",
      raw_data: null,
      source: "manual",
    }));
    setFnsStatus(null);
    setShowAdd(true);
  }

  const customFilterActive = dateFrom !== defaultFrom || dateTo !== defaultTo;
  const inDate = (r) => {
    if (customFilterActive)
      return (!dateFrom || r.date >= dateFrom) && (!dateTo || r.date <= dateTo);
    return inPeriod(r.date, activePeriod);
  };
  const filtered = receipts.filter((r) => {
    if (cats.length > 0 && !cats.includes(catName(r))) return false;
    if (selCards.length > 0 && !selCards.includes(r.payment)) return false;
    if (sources.length > 0 && !sources.includes(r.source)) return false;
    if (!search) return inDate(r);
    const q = search.toLowerCase();
    return (
      (r.org.toLowerCase().includes(q) ||
        shortOrg(r.org).toLowerCase().includes(q)) &&
      inDate(r)
    );
  });
  const groups = groupByMonth(filtered.slice(0, limit));
  const hiddenCount = filtered.length - limit;
  const filtersActive =
    customFilterActive ||
    cats.length > 0 ||
    selCards.length > 0 ||
    sources.length > 0;
  const resetFilters = () => {
    setDateFrom(defaultFrom);
    setDateTo(defaultTo);
    setCats([]);
    setSelCards([]);
    setSources([]);
    setSearch("");
  };

  async function addR() {
    if (isSubmitting) return; // защита от двойного клика
    if (!form.org || !form.amount) {
      setAddError("Заполните организацию и сумму");
      return;
    }
    setIsSubmitting(true);
    setAddError("");
    setDupId(null);
    try {
      const payload = {
        date: form.date,
        org: form.org,
        category: form.category,
        payment: form.payment,
        amount: Number(form.amount),
        source: form.source || "manual",
      };
      if (form.fn) payload.kkt_fn = form.fn; // form.fn — внутреннее имя инпута; шлём как kkt_fn (канон)
      if (form.raw_data) payload.raw_data = form.raw_data;
      const res = await authFetch(`/api/receipts/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 409) {
        const body = await res.json().catch(() => null);
        setDupId(body?.detail?.existing_id || null); // плашка предложит «Открыть» существующий
        setAddError("Этот чек уже добавлен");
        return;
      }
      if (!res.ok) {
        setAddError("Не удалось добавить чек. Попробуйте ещё раз");
        return;
      }
      // warning (мягкий дубль) идёт рядом с полями чека — вынимаем его, чтобы
      // не осело лишним полем на объекте в списке; чек добавляем без него.
      const { warning, ...receipt } = await res.json();
      handleAdd(receipt);
      setShowAdd(false);
      setForm({
        org: "",
        amount: "",
        category: "Не указано",
        payment: "Не указано",
        date: todayISO(),
        fn: "",
        raw_data: null,
        source: "manual",
      });
      setFnsStatus(null);
      setAddError("");
      setDupId(null);
      setDupWarning(warning || null);
    } catch {
      setAddError("Не удалось добавить чек. Проверьте интернет");
    } finally {
      setIsSubmitting(false);
    }
  }

  // From the 409 banner: jump to the receipt that already exists.
  async function openDup() {
    if (!dupId) return;
    try {
      const er = await authFetch(`/api/receipts/${dupId}`);
      if (er.ok) {
        const ex = await er.json();
        handleAdd(ex);
        setShowAdd(false);
        setForm({
          org: "",
          amount: "",
          category: "Не указано",
          payment: "Не указано",
          date: todayISO(),
          fn: "",
          raw_data: null,
          source: "manual",
        });
        setFnsStatus(null);
        setAddError("");
        setDupId(null);
        setDetail({ ...ex, amount: Number(ex.amount) });
      }
    } catch {
      /* network — leave the banner as is */
    }
  }

  // Клик «Удалить выбранные» в баннере → bulk-delete + toast по результату.
  // Возвращает true (успех — баннер закрыт) / false (ошибка — баннер остаётся).
  async function deleteDuplicates(ids) {
    const body = await handleBulkDelete(ids, false);
    if (!body) {
      setToast({
        type: "error",
        message: "Не удалось удалить",
        duration: 4000,
      });
      return false;
    }
    setDupWarning(null);
    const nd = body.deleted.length;
    const blocked = [];
    if (body.blocked_in_report.length)
      blocked.push(`${body.blocked_in_report.length} в отчёте`);
    if (body.blocked_fns.length) blocked.push(`${body.blocked_fns.length} ФНС`);
    if (nd === 0)
      setToast({
        type: "warning",
        message: `Ничего не удалено: ${blocked.join(", ")}`,
        duration: 5000,
      });
    else if (blocked.length)
      setToast({
        type: "warning",
        message: `✓ Удалено ${nd} ${plural(nd, [
          "чек",
          "чека",
          "чеков",
        ])}. Заблокировано: ${blocked.join(", ")}`,
        duration: 5000,
      });
    else
      setToast({
        type: "success",
        message: `✓ Удалено ${nd} ${plural(nd, ["чек", "чека", "чеков"])}`,
        duration: 3000,
      });
    return true;
  }

  return (
    <div style={{ position: "relative" }}>
      <Toast toast={toast} />
      {dupWarning && (
        <DuplicateWarningBanner
          warning={dupWarning}
          onDelete={deleteDuplicates}
          onClose={() => setDupWarning(null)}
        />
      )}
      {/* TODO: ФНС «Мои чеки онлайн» — включить когда будет готова интеграция
      <TabBar tabs={["Чеки","Онлайн чеки"]} active={tab} onSelect={setTab}/> */}
      <div
        style={{
          background: C.white,
          borderBottom: `1px solid ${C.silver}`,
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            border: `1px solid #EEF0F4`,
            padding: "8px 12px",
            gap: 8,
            background: "#F6F7F9",
            borderRadius: 10,
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke={C.grayL}
            strokeWidth="2"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск..."
            aria-label="Поиск по операциям"
            style={{
              border: "none",
              outline: "none",
              flex: 1,
              minWidth: 0,
              fontSize: 13,
              background: "none",
              fontFamily: FONT,
              color: C.dark,
            }}
          />
        </div>
        <PeriodPicker
          value={activePeriod}
          onChange={(k) => {
            setActivePeriod(k);
            setDateFrom(defaultFrom);
            setDateTo(defaultTo);
          }}
        />
        <FilterIcon
          active={filtersActive}
          onClick={() => setShowFilters(true)}
        />
      </div>
      <div style={{ paddingBottom: 80 }}>
        {groups.map(([key, group]) => (
          <div key={key} style={{ marginTop: 6 }}>
            <div
              style={{
                padding: "10px 16px 6px",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <div
                style={{
                  width: 3,
                  height: 12,
                  background: C.borderD,
                  borderRadius: 2,
                }}
              />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: C.gray,
                  fontFamily: FONT,
                }}
              >
                {group.label}
              </span>
            </div>
            <div
              style={{
                margin: "0 12px",
                borderRadius: 12,
                overflow: "hidden",
                background: C.white,
                border: `1px solid ${C.silver}`,
              }}
            >
              {group.items.map((r, i) => (
                <div key={r.id}>
                  <SwipeableReceiptCard
                    receipt={r}
                    onClick={() => setDetail(r)}
                    onDelete={() => handleDelete(r.id)}
                  />
                  {i < group.items.length - 1 && (
                    <div
                      style={{
                        height: 1,
                        background: C.silver,
                        marginLeft: 62,
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        {groups.length === 0 && (
          <div
            style={{
              textAlign: "center",
              padding: "56px 24px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
            }}
          >
            <ReceiptText size={48} color="#EEF0F4" strokeWidth={1.5} />
            {filtersActive || search ? (
              <>
                <div
                  style={{ fontSize: 15, color: "#636B7D", fontFamily: FONT }}
                >
                  Ничего не найдено
                </div>
                <div
                  style={{ fontSize: 13, color: "#9CA3AF", fontFamily: FONT }}
                >
                  Попробуйте изменить фильтры
                </div>
                <button
                  onClick={resetFilters}
                  style={{
                    marginTop: 4,
                    background: "none",
                    border: "none",
                    color: C.cherry,
                    fontFamily: FONT,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Сбросить фильтры
                </button>
              </>
            ) : (
              <>
                <div
                  style={{ fontSize: 15, color: "#636B7D", fontFamily: FONT }}
                >
                  Нет чеков за этот период
                </div>
                <div
                  style={{ fontSize: 13, color: "#9CA3AF", fontFamily: FONT }}
                >
                  Нажмите + чтобы добавить первый чек
                </div>
              </>
            )}
          </div>
        )}
        {hiddenCount > 0 && (
          <div style={{ padding: "14px 16px", textAlign: "center" }}>
            <button
              onClick={() => setLimit((l) => l + 30)}
              style={{
                padding: "10px 20px",
                border: `1px solid ${C.silver}`,
                background: C.white,
                color: C.cherry,
                fontFamily: FONT,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                borderRadius: 10,
                letterSpacing: "0.03em",
              }}
            >
              Показать ещё {Math.min(30, hiddenCount)} · осталось {hiddenCount}
            </button>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => setShowScan(true)}
        aria-label="Добавить чек"
        style={{
          position: "fixed",
          bottom: "calc(env(safe-area-inset-bottom) + 72px)",
          right: 20,
          width: 44,
          height: 44,
          background: C.cherry,
          color: C.white,
          border: "none",
          fontSize: 20,
          cursor: "pointer",
          boxShadow: `0 4px 12px rgba(17,19,24,0.18)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "50%",
        }}
      >
        <Plus size={22} aria-hidden="true" />
      </button>
      {showScan && (
        <ScanReceiptModal
          onClose={() => setShowScan(false)}
          onCapture={handleCapture}
          onPrefetch={prefetchFns}
          onOcrFile={handleOcrFile}
          onManual={handleManual}
        />
      )}
      {showReq && (
        <RequisitesSheet
          prefill={reqPrefill}
          onClose={() => setShowReq(false)}
          onVerify={handleCapture}
          onManualFallback={openManualForm}
        />
      )}
      {showFilters && (
        <FiltersModal
          dateBuilder
          from={dateFrom}
          to={dateTo}
          catalog={catalog}
          cards={cards}
          sources={sources}
          selectedCats={cats}
          selectedCards={selCards}
          onApply={(r) => {
            setDateFrom(r.from);
            setDateTo(r.to);
            setCats(r.cats);
            setSelCards(r.cards);
            setSources(r.sources);
          }}
          onReset={() => {
            setDateFrom(defaultFrom);
            setDateTo(defaultTo);
            setCats([]);
            setSelCards([]);
            setSources([]);
          }}
          onClose={() => setShowFilters(false)}
        />
      )}
      {detail && (
        <ReceiptDetailModal
          receipt={detail}
          paymentOptions={paymentOptions}
          catalog={catalog}
          onClose={() => setDetail(null)}
          onDelete={() => {
            handleDelete(detail.id);
            setDetail(null);
          }}
          onChangeCategory={async (c) => {
            const upd = await handleUpdate(detail.id, { category: c });
            if (upd) setDetail(upd);
          }}
          onChangePayment={async (p) => {
            const upd = await handleUpdate(detail.id, { payment: p });
            if (upd) setDetail(upd);
          }}
        />
      )}
      {showCatSheet && (
        <CategorySheet
          catalog={catalog}
          selected={form.category}
          onPick={(c) => setForm((p) => ({ ...p, category: c }))}
          onClose={() => setShowCatSheet(false)}
        />
      )}
      {showAdd && (
        <Modal
          title="Добавить чек"
          onClose={() => {
            setShowAdd(false);
            setFnsStatus(null);
            setAddError("");
            setDupId(null);
          }}
          footer={
            <>
              {addError && (
                <div
                  style={{
                    marginBottom: 8,
                    padding: "8px 12px",
                    background: "#FEF2F2",
                    border: "1px solid #FECACA",
                    borderRadius: 8,
                    fontFamily: FONT,
                    fontSize: 12,
                    color: "#B91C1C",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <span>{addError}</span>
                  {dupId && (
                    <button
                      onClick={openDup}
                      style={{
                        flexShrink: 0,
                        border: "none",
                        background: "none",
                        color: "#B91C1C",
                        fontFamily: FONT,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                        textDecoration: "underline",
                        padding: 0,
                      }}
                    >
                      Открыть
                    </button>
                  )}
                </div>
              )}
              <Btn
                full
                onClick={addR}
                disabled={!form.org || !form.amount}
                loading={isSubmitting}
              >
                {isSubmitting ? "Добавляю…" : "Добавить чек"}
              </Btn>
            </>
          }
        >
          <div style={{ paddingTop: 12 }}>
            {fnsStatus === "loading" && (
              <div
                style={{
                  marginBottom: 12,
                  padding: "8px 12px",
                  background: "#EEF0F4",
                  border: `1px solid ${C.silver}`,
                  borderRadius: 6,
                  fontFamily: FONT,
                  fontSize: 11,
                  color: C.mid,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  style={{ flexShrink: 0 }}
                >
                  <circle cx="12" cy="12" r="9" strokeOpacity="0.25" />
                  <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round">
                    <animateTransform
                      attributeName="transform"
                      type="rotate"
                      from="0 12 12"
                      to="360 12 12"
                      dur="0.8s"
                      repeatCount="indefinite"
                    />
                  </path>
                </svg>
                Загружаем данные из ФНС…
              </div>
            )}
            {fnsStatus === "ok" && (
              <div
                style={{
                  marginBottom: 12,
                  padding: "8px 12px",
                  background: "#ECFDF5",
                  border: "1px solid #A7F3D0",
                  borderRadius: 6,
                  fontFamily: FONT,
                  fontSize: 11,
                  color: "#047857",
                }}
              >
                Электронный чек загружен ✓
              </div>
            )}
            {fnsStatus === "partial" && (
              <div
                style={{
                  marginBottom: 12,
                  padding: "8px 12px",
                  background: "#FFFBEB",
                  border: "1px solid #FDE68A",
                  borderRadius: 6,
                  fontFamily: FONT,
                  fontSize: 11,
                  color: "#B45309",
                }}
              >
                Данные ФНС не загрузились. Заполните организацию вручную.
              </div>
            )}
            <RuleInput
              label="Организация"
              value={form.org}
              onChange={(v) => setForm((p) => ({ ...p, org: v }))}
              placeholder="Яндекс.Такси"
            />
            <RuleInput
              label="Сумма (₽)"
              value={form.amount}
              onChange={(v) => setForm((p) => ({ ...p, amount: v }))}
              type="number"
              placeholder="0.00"
            />
            <RuleInput
              label="Дата"
              value={form.date}
              onChange={(v) => setForm((p) => ({ ...p, date: v }))}
              type="date"
            />
            <div style={{ marginBottom: 12 }}>
              <div
                style={{
                  fontSize: 9,
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  color: C.gray,
                  marginBottom: 6,
                  fontFamily: FONT,
                }}
              >
                Категория
              </div>
              <button
                onClick={() => setShowCatSheet(true)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  border: `1px solid ${C.silver}`,
                  background: C.white,
                  borderRadius: 10,
                  cursor: "pointer",
                  fontFamily: FONT,
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: catColor(form.category).fg,
                    flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
                  <span
                    style={{
                      display: "block",
                      fontSize: 13,
                      color: C.dark,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {form.category || "Не указано"}
                  </span>
                  {groupOf(form.category) && (
                    <span
                      style={{ display: "block", fontSize: 10, color: C.gray }}
                    >
                      {groupOf(form.category)}
                    </span>
                  )}
                </span>
                <span style={{ color: C.grayL, fontSize: 18, flexShrink: 0 }}>
                  ›
                </span>
              </button>
              {(!form.category ||
                form.category === "Не указано" ||
                form.category === "Прочие хозрасходы") && (
                <div
                  style={{
                    marginTop: 6,
                    padding: "6px 10px",
                    background: "#FFFBEB",
                    border: "1px solid #FDE68A",
                    borderRadius: 8,
                    fontFamily: FONT,
                    fontSize: 11,
                    color: "#B45309",
                  }}
                >
                  Проверьте категорию
                </div>
              )}
            </div>
            <div style={{ marginBottom: 8 }}>
              <div
                style={{
                  fontSize: 9,
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  color: C.gray,
                  marginBottom: 6,
                  fontFamily: FONT,
                }}
              >
                Метод оплаты
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {paymentOptions.map((m) => (
                  <button
                    key={m}
                    onClick={() => setForm((p) => ({ ...p, payment: m }))}
                    style={{
                      padding: "4px 10px",
                      border: `1px solid ${
                        form.payment === m ? C.cherry : C.silver
                      }`,
                      background: form.payment === m ? C.cherryL : C.white,
                      color: form.payment === m ? C.cherry : C.mid,
                      fontFamily: FONT,
                      fontSize: 11,
                      cursor: "pointer",
                      borderRadius: 6,
                    }}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function OtchetyPage({ receipts }) {
  const [tab, setTab] = useState("Личные");
  const [reports, setReports] = useState([]);
  const [search, setSearch] = useState("");
  const [showC, setShowC] = useState(false);
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState([]);

  useEffect(() => {
    authFetch(`/api/reports/`)
      .then((r) => r.json())
      .then((data) => setReports(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const usedIds = reports.flatMap((r) => r.receiptIds || []);
  const free = receipts.filter((r) => !usedIds.includes(r.id));

  async function create() {
    const sel = free.filter((r) => selected.includes(r.id));
    const total = sel.reduce((s, r) => s + Number(r.amount), 0);
    const res = await authFetch(`/api/reports/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, total, receiptIds: selected }),
    });
    const created = await res.json();
    setReports((prev) => [...prev, created]);
    setTitle("");
    setSelected([]);
    setShowC(false);
  }

  async function changeStatus(id, status) {
    const res = await authFetch(`/api/reports/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const updated = await res.json();
    setReports((prev) => prev.map((r) => (r.id === id ? updated : r)));
  }

  const filtered = reports.filter(
    (r) =>
      r.status === tab &&
      (!search || r.title.toLowerCase().includes(search.toLowerCase())),
  );
  const ST = {
    Личные: { bg: C.lightGray, color: C.mid, b: C.silver },
    "На проверке": { bg: "#FEF3C7", color: "#92400E", b: "#FCD34D" },
    Одобрен: { bg: "#ECFDF5", color: "#065F46", b: "#6EE7B7" },
    Отклонён: { bg: "#FCEBEB", color: "#B91C1C", b: "#F5C2C2" },
  };
  return (
    <div>
      <TabBar
        tabs={["Личные", "На проверке", "Номинальные"]}
        active={tab}
        onSelect={setTab}
      />
      <div
        style={{
          background: C.white,
          borderBottom: `1px solid ${C.silver}`,
          padding: "10px 16px",
          display: "flex",
          gap: 8,
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            border: `1px solid ${C.silver}`,
            padding: "7px 12px",
            gap: 8,
            background: C.lightGray,
            borderRadius: 6,
          }}
        >
          <span style={{ color: C.grayL }}>⌕</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск..."
            aria-label="Поиск по отчётам"
            style={{
              border: "none",
              outline: "none",
              flex: 1,
              fontSize: 13,
              background: "none",
              fontFamily: FONT,
              color: C.dark,
            }}
          />
        </div>
        <Btn small onClick={() => setShowC(true)}>
          + Новый
        </Btn>
      </div>
      {filtered.length === 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "80px 20px",
            gap: 16,
          }}
        >
          <ClipboardList size={44} strokeWidth={1.25} color={C.grayL} />
          {tab === "Личные" ? (
            <Btn onClick={() => setShowC(true)}>Создать первый отчёт</Btn>
          ) : (
            <span
              style={{
                color: C.grayL,
                fontFamily: FONT,
                fontSize: 11,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
              }}
            >
              Отчёты отсутствуют
            </span>
          )}
        </div>
      ) : (
        <div style={{ paddingBottom: 80 }}>
          <div
            style={{
              background: C.lightGray,
              borderBottom: `1px solid ${C.silver}`,
              display: "grid",
              gridTemplateColumns: "1fr 100px 90px",
              padding: "7px 14px",
              gap: 8,
            }}
          >
            {["Наименование", "Сумма", "Статус"].map((h) => (
              <div
                key={h}
                style={{
                  fontSize: 9,
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  color: C.gray,
                  fontFamily: FONT,
                }}
              >
                {h}
              </div>
            ))}
          </div>
          {filtered.map((rep) => {
            const st = ST[rep.status] || ST["Личные"];
            return (
              <div
                key={rep.id}
                style={{
                  background: C.white,
                  borderBottom: `1px solid ${C.silver}`,
                  borderLeft: `3px solid ${
                    rep.status === "Личные" ? C.silver : C.cherry
                  }`,
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 100px 90px",
                    padding: "11px 14px",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontFamily: FONT,
                        fontSize: 13,
                        color: C.dark,
                        fontWeight: 700,
                        marginBottom: 2,
                      }}
                    >
                      {rep.title}
                    </div>
                    <div
                      style={{ fontFamily: FONT, fontSize: 10, color: C.gray }}
                    >
                      {fmtDate(rep.date)} · {(rep.receiptIds || []).length}{" "}
                      чеков
                    </div>
                  </div>
                  <div
                    style={{
                      fontFamily: FONT,
                      fontSize: 13,
                      color: C.dark,
                      fontWeight: 700,
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {fmt(rep.total)}
                  </div>
                  <div
                    style={{
                      padding: "2px 6px",
                      background: st.bg,
                      border: `1px solid ${st.b}`,
                      fontSize: 9,
                      fontFamily: FONT,
                      color: st.color,
                      textAlign: "center",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      borderRadius: 4,
                    }}
                  >
                    {rep.status}
                  </div>
                </div>
                {rep.status === "Личные" && (
                  <div style={{ padding: "0 14px 10px" }}>
                    <Btn
                      small
                      onClick={() => changeStatus(rep.id, "На проверке")}
                    >
                      На проверку →
                    </Btn>
                  </div>
                )}
                {rep.status === "На проверке" && (
                  <div
                    style={{ padding: "0 14px 10px", display: "flex", gap: 6 }}
                  >
                    <Btn small onClick={() => changeStatus(rep.id, "Одобрен")}>
                      ✓ Одобрить
                    </Btn>
                    <Btn
                      small
                      outline
                      onClick={() => changeStatus(rep.id, "Отклонён")}
                    >
                      Отклонить
                    </Btn>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {showC && (
        <Modal
          title="Новый отчёт"
          onClose={() => setShowC(false)}
          footer={
            <Btn full onClick={create} disabled={!title || !selected.length}>
              Создать отчёт
            </Btn>
          }
        >
          <div style={{ paddingTop: 12 }}>
            <RuleInput
              label="Название отчёта"
              value={title}
              onChange={setTitle}
              placeholder="Командировка, май 2026"
            />
            <div
              style={{
                fontSize: 9,
                letterSpacing: "0.15em",
                textTransform: "uppercase",
                color: C.gray,
                marginBottom: 8,
                fontFamily: FONT,
              }}
            >
              Выберите чеки · {selected.length} выбрано
            </div>
            {free.length === 0 && (
              <Block>
                <span style={{ fontFamily: FONT, fontSize: 12, color: C.mid }}>
                  Нет свободных чеков
                </span>
              </Block>
            )}
            {free.map((r) => {
              const sel = selected.includes(r.id);
              return (
                <div
                  key={r.id}
                  onClick={() =>
                    setSelected((prev) =>
                      sel ? prev.filter((x) => x !== r.id) : [...prev, r.id],
                    )
                  }
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "9px 10px",
                    marginBottom: 4,
                    border: `1px solid ${sel ? C.cherry : C.silver}`,
                    background: sel ? C.cherryL : C.white,
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      width: 12,
                      height: 12,
                      border: `1.5px solid ${sel ? C.cherry : C.silver}`,
                      background: sel ? C.cherry : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: C.white,
                      fontSize: 10,
                      flexShrink: 0,
                      borderRadius: 3,
                    }}
                  >
                    {sel && "✓"}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontFamily: FONT,
                        fontSize: 13,
                        color: C.dark,
                        fontWeight: 700,
                      }}
                    >
                      {shortOrg(r.org)}
                    </div>
                    <div
                      style={{ fontFamily: FONT, fontSize: 10, color: C.gray }}
                    >
                      {fmtDate(r.date)} · {catName(r)}
                    </div>
                  </div>
                  <span
                    style={{
                      fontFamily: FONT,
                      fontSize: 13,
                      color: C.cherry,
                      fontWeight: 700,
                    }}
                  >
                    {fmt(r.amount)}
                  </span>
                </div>
              );
            })}
            {selected.length > 0 && (
              <Block>
                <div
                  style={{ display: "flex", justifyContent: "space-between" }}
                >
                  <span
                    style={{ fontFamily: FONT, fontSize: 11, color: C.gray }}
                  >
                    Итого:
                  </span>
                  <span
                    style={{
                      fontFamily: FONT,
                      fontSize: 14,
                      color: C.cherry,
                      fontWeight: 700,
                    }}
                  >
                    {fmt(
                      free
                        .filter((r) => selected.includes(r.id))
                        .reduce((s, r) => s + Number(r.amount), 0),
                    )}
                  </span>
                </div>
              </Block>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── SETTINGS HELPERS & PARTS ─────────────────────────────
const ROLE_LABEL = Object.fromEntries(ROLES.map((r) => [r.id, r.label]));
const roleLabel = (id) => ROLE_LABEL[id] || "Сотрудник";
const ROLE_ICON = {
  admin: "👑",
  employee: "👤",
  manager: "👥",
  accountant: "🧮",
};
const userInitials = (u) =>
  `${(u.first_name || "")[0] || ""}${
    (u.last_name || "")[0] || ""
  }`.toUpperCase() || "?";

const SVC_ICON = { fns: "🧾", alfabank: "🏦", anthropic: "🤖" };
const SVC_STATUS = {
  active: { label: "Активен", bg: "#F0FDF4", fg: "#15803D" },
  in_progress: { label: "В разработке", bg: "#FFFBEB", fg: "#B45309" },
  not_connected: { label: "Не подключено", bg: "#EEF0F4", fg: "#636B7D" },
  not_configured: { label: "Не настроен", bg: "#EEF0F4", fg: "#636B7D" },
};

function ServiceCard({ svc }) {
  const m = SVC_STATUS[svc.status] || SVC_STATUS.not_connected;
  return (
    <div
      style={{
        background: C.white,
        border: `1px solid ${C.silver}`,
        borderRadius: 8,
        padding: "12px 14px",
        marginBottom: 10,
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          background: C.lightGray,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 18,
          flexShrink: 0,
        }}
      >
        {SVC_ICON[svc.key] || "⚙"}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            marginBottom: 3,
          }}
        >
          <span
            style={{
              fontFamily: FONT,
              fontSize: 13,
              fontWeight: 700,
              color: C.dark,
            }}
          >
            {svc.name}
          </span>
          <span
            style={{
              fontFamily: FONT,
              fontSize: 10,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 10,
              background: m.bg,
              color: m.fg,
              whiteSpace: "nowrap",
            }}
          >
            {m.label}
          </span>
        </div>
        <div
          style={{
            fontFamily: FONT,
            fontSize: 11,
            color: C.gray,
            lineHeight: 1.4,
          }}
        >
          {svc.description}
        </div>
        {svc.key === "fns" && (
          <div style={{ marginTop: 8 }}>
            <button
              disabled
              title="Скоро"
              style={{
                padding: "6px 14px",
                border: `1px solid ${C.silver}`,
                background: C.lightGray,
                color: C.grayL,
                fontFamily: FONT,
                fontSize: 12,
                borderRadius: 8,
                cursor: "not-allowed",
              }}
            >
              Подключить
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Swipe-left to reveal "Удалить" — mirrors SwipeableReceiptCard's pointer logic.
function SwipeableUserRow({ user, onDelete, deletable = true }) {
  const [tx, setTx] = useState(0);
  const [drag, setDrag] = useState(false); // render-safe mirror of dragging.current
  const startX = useRef(0),
    startY = useRef(0),
    dragging = useRef(false),
    locked = useRef(null);
  const REVEAL = 72;
  const u = user;
  const name =
    [u.last_name, u.first_name, u.patronymic].filter(Boolean).join(" ") ||
    u.email ||
    "Без имени";
  function down(e) {
    if (!deletable) return;
    dragging.current = true;
    setDrag(true);
    locked.current = null;
    startX.current = e.clientX;
    startY.current = e.clientY;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function move(e) {
    if (!dragging.current) return;
    const dx = e.clientX - startX.current,
      dy = e.clientY - startY.current;
    if (locked.current === null) {
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6)
        locked.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      else return;
    }
    if (locked.current !== "x") return;
    const base = tx < 0 ? -REVEAL : 0;
    setTx(Math.min(0, Math.max(-REVEAL, base + dx)));
  }
  function up() {
    if (!dragging.current) return;
    dragging.current = false;
    setDrag(false);
    if (locked.current === "x") setTx(tx < -REVEAL / 2 ? -REVEAL : 0);
  }
  return (
    <div
      style={{
        position: "relative",
        background: "#B91C1C",
        borderBottom: `1px solid ${C.silver}`,
        overflow: "hidden",
      }}
    >
      {deletable && (
        <div
          onClick={onDelete}
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            width: REVEAL,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            color: "#fff",
            fontFamily: FONT,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Удалить
        </div>
      )}
      <div
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        style={{
          background: C.white,
          padding: "11px 14px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          transform: `translateX(${tx}px)`,
          transition: drag ? "none" : "transform 0.2s ease",
          userSelect: "none",
          touchAction: "pan-y",
          borderLeft: `3px solid ${
            u.is_active !== false ? C.cherry : C.silver
          }`,
        }}
      >
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: "50%",
            background: C.cherry,
            color: C.white,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: FONT,
            fontSize: 11,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {userInitials(u)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: FONT,
              fontSize: 13,
              color: C.dark,
              fontWeight: 700,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {name}
          </div>
          <div style={{ fontFamily: FONT, fontSize: 11, color: C.gray }}>
            {roleLabel(u.role)} ·{" "}
            {u.is_active !== false ? "активен" : "неактивен"}
          </div>
        </div>
      </div>
    </div>
  );
}

function AddEmployeeSheet({ onClose, onAdd }) {
  const [f, setF] = useState({
    first_name: "",
    last_name: "",
    patronymic: "",
    email: "",
    role: "employee",
  });
  const [busy, setBusy] = useState(false);
  const ROLE_CHIPS = [
    ["employee", "Сотрудник"],
    ["manager", "Руководитель"],
    ["accountant", "Бухгалтер"],
  ];
  const inp = {
    width: "100%",
    padding: "10px 12px",
    border: `1px solid ${C.silver}`,
    borderRadius: 8,
    fontSize: 13,
    fontFamily: FONT,
    color: C.dark,
    background: C.white,
    boxSizing: "border-box",
  };
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  async function submit() {
    if (!f.first_name.trim() || busy) return;
    setBusy(true);
    await onAdd(f);
    setBusy(false);
    onClose();
  }
  const dialogRef = useModalA11y(onClose);
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(22,26,29,0.5)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 300,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Новый сотрудник"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.white,
          width: "100%",
          maxWidth: 480,
          borderRadius: "16px 16px 0 0",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          maxHeight: "88dvh",
          paddingBottom: "env(safe-area-inset-bottom)",
          outline: "none",
        }}
      >
        <div
          style={{
            padding: "14px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: `1px solid ${C.silver}`,
          }}
        >
          <span
            style={{
              fontFamily: FONT,
              fontSize: 14,
              fontWeight: 600,
              color: C.dark,
            }}
          >
            Новый сотрудник
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            style={{
              border: "none",
              background: "none",
              color: C.gray,
              cursor: "pointer",
              fontSize: 20,
              padding: 4,
              lineHeight: 1,
            }}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <div
          style={{
            overflow: "auto",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <input
            style={inp}
            placeholder="Имя"
            aria-label="Имя"
            value={f.first_name}
            onChange={(e) => set("first_name", e.target.value)}
          />
          <input
            style={inp}
            placeholder="Фамилия"
            aria-label="Фамилия"
            value={f.last_name}
            onChange={(e) => set("last_name", e.target.value)}
          />
          <input
            style={inp}
            placeholder="Отчество"
            aria-label="Отчество"
            value={f.patronymic}
            onChange={(e) => set("patronymic", e.target.value)}
          />
          <input
            style={inp}
            placeholder="Email"
            aria-label="Email"
            type="email"
            value={f.email}
            onChange={(e) => set("email", e.target.value)}
          />
          <div>
            <div
              style={{
                fontSize: 10,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: C.gray,
                fontFamily: FONT,
                marginBottom: 8,
              }}
            >
              Роль
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {ROLE_CHIPS.map(([val, label]) => {
                const on = f.role === val;
                return (
                  <button
                    key={val}
                    onClick={() => set("role", val)}
                    style={{
                      padding: "6px 12px",
                      border: "none",
                      borderRadius: 8,
                      cursor: "pointer",
                      fontFamily: FONT,
                      fontSize: 12,
                      fontWeight: on ? 600 : 500,
                      background: on ? C.cherry : "#EEF0F4",
                      color: on ? "#fff" : "#636B7D",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div
          style={{
            padding: "12px 16px",
            borderTop: `1px solid ${C.silver}`,
            background: C.lightGray,
          }}
        >
          <Btn full onClick={submit} disabled={!f.first_name.trim() || busy}>
            Добавить сотрудника
          </Btn>
        </div>
      </div>
    </div>
  );
}

// +7 999 123 45 67 mask
function formatPhone(v) {
  let d = (v || "").replace(/\D/g, "");
  if (d.startsWith("8")) d = "7" + d.slice(1);
  if (d && !d.startsWith("7")) d = "7" + d;
  d = d.slice(0, 11);
  if (!d) return ""; // empty input → empty (placeholder shows)
  let out = "+7";
  if (d.length > 1) out += " " + d.slice(1, 4);
  if (d.length >= 5) out += " " + d.slice(4, 7);
  if (d.length >= 8) out += " " + d.slice(7, 9);
  if (d.length >= 10) out += " " + d.slice(9, 11);
  return out;
}

function ChangePasswordModal({ onClose }) {
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [rep, setRep] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const inp = {
    width: "100%",
    padding: "11px 12px",
    border: `1px solid ${C.silver}`,
    borderRadius: 8,
    fontSize: 14,
    fontFamily: FONT,
    color: C.dark,
    background: C.white,
    boxSizing: "border-box",
    outline: "none",
  };
  async function submit() {
    setErr("");
    if (newPw.length < 8) {
      setErr("Новый пароль не менее 8 символов");
      return;
    }
    if (newPw !== rep) {
      setErr("Пароли не совпадают");
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const res = await authFetch("/api/users/me/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ old_password: oldPw, new_password: newPw }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setDone(true);
        setTimeout(onClose, 1200);
        return;
      }
      setErr(
        typeof d.detail === "string" ? d.detail : "Не удалось изменить пароль",
      );
    } catch {
      setErr("Нет связи с сервером");
    } finally {
      setBusy(false);
    }
  }
  const dialogRef = useModalA11y(onClose);
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.3)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 300,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Изменить пароль"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.white,
          width: "100%",
          maxWidth: 480,
          borderRadius: "16px 16px 0 0",
          display: "flex",
          flexDirection: "column",
          paddingBottom: "env(safe-area-inset-bottom)",
          outline: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "8px 0 2px",
          }}
        >
          <div
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              background: "#D5D7DD",
            }}
          />
        </div>
        <div
          style={{
            padding: "4px 16px 12px",
            borderBottom: `1px solid ${C.silver}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: 15,
              fontFamily: FONT,
              color: C.dark,
              fontWeight: 600,
            }}
          >
            Изменить пароль
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            style={{
              border: "none",
              background: "none",
              color: C.gray,
              fontSize: 18,
              cursor: "pointer",
            }}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <div
          style={{
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {done ? (
            <div
              style={{
                textAlign: "center",
                padding: "16px 0",
                fontSize: 15,
                color: "#15803D",
                fontFamily: FONT,
                fontWeight: 600,
              }}
            >
              Пароль изменён ✓
            </div>
          ) : (
            <>
              <input
                style={inp}
                type={show ? "text" : "password"}
                placeholder="Текущий пароль"
                aria-label="Текущий пароль"
                value={oldPw}
                onChange={(e) => setOldPw(e.target.value)}
              />
              <input
                style={inp}
                type={show ? "text" : "password"}
                placeholder="Новый пароль (от 8 символов)"
                aria-label="Новый пароль"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
              />
              <input
                style={inp}
                type={show ? "text" : "password"}
                placeholder="Повторите новый пароль"
                aria-label="Повторите новый пароль"
                value={rep}
                onChange={(e) => setRep(e.target.value)}
              />
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  color: C.gray,
                  fontFamily: FONT,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={show}
                  onChange={(e) => setShow(e.target.checked)}
                  aria-label="Показать пароли"
                  style={{ accentColor: C.cherry }}
                />{" "}
                Показать пароли
              </label>
              {err && (
                <div
                  style={{ color: C.cherry, fontSize: 13, fontFamily: FONT }}
                >
                  {err}
                </div>
              )}
              <Btn full onClick={submit} disabled={busy}>
                {busy ? "Сохраняем…" : "Сохранить пароль"}
              </Btn>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AccountTab() {
  const [me, setMe] = useState(null);
  const [acc, setAcc] = useState({
    first_name: "",
    last_name: "",
    phone: "",
    employee_number: "",
  });
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");
  const [showPwModal, setShowPwModal] = useState(false);

  // Phone is stored E.164 ("+79991234567") in the DB; mask it for display.
  const fromApi = (d) => ({
    first_name: d.first_name || "",
    last_name: d.last_name || "",
    phone: formatPhone(d.phone || ""),
    employee_number: d.employee_number || "",
  });

  useEffect(() => {
    authFetch("/api/users/me")
      .then((r) => r.json())
      .then((d) => {
        if (d && d.id) {
          setMe(d);
          setAcc(fromApi(d));
        }
      })
      .catch(() => {});
  }, []);

  const set = (k, v) => setAcc((p) => ({ ...p, [k]: v }));
  async function save() {
    const fn = acc.first_name.trim(),
      ln = acc.last_name.trim();
    const digits = acc.phone.replace(/\D/g, ""); // "79991234567" | ""
    if (!fn) {
      setErr("Укажите имя");
      return;
    }
    if (!ln) {
      setErr("Укажите фамилию");
      return;
    }
    if (digits && digits.length !== 11) {
      setErr("Телефон: 11 цифр или оставьте пустым");
      return;
    }
    setErr("");
    const payload = {
      first_name: fn,
      last_name: ln,
      phone: digits ? "+" + digits : "",
      employee_number: acc.employee_number.trim(),
    };
    const res = await authFetch("/api/users/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const d = await res.json().catch(() => null);
      if (d && d.id) {
        setMe(d);
        setAcc(fromApi(d));
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } else {
      setErr("Не удалось сохранить");
    }
  }
  const oauthSoon = () => alert("Скоро");

  if (!me)
    return (
      <div
        style={{
          padding: "40px 20px",
          textAlign: "center",
          color: C.grayL,
          fontFamily: FONT,
          fontSize: 13,
        }}
      >
        Загрузка…
      </div>
    );

  const role = me.role || "employee";
  const roleDesc = (ROLES.find((r) => r.id === role) || {}).desc || "";
  const consent = me.consent;
  const rowStyle = (i) => ({
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "3px 12px",
    borderBottom: `1px solid ${C.silver}`,
    background: i % 2 === 0 ? C.white : C.lightGray,
  });
  const lbl = {
    fontSize: 11,
    color: C.gray,
    fontFamily: FONT,
    minWidth: 110,
    flexShrink: 0,
  };
  const fin = {
    flex: 1,
    textAlign: "right",
    border: "none",
    background: "transparent",
    fontSize: 13,
    color: C.dark,
    fontFamily: FONT,
    outline: "none",
    padding: "7px 0",
  };
  const PROVIDERS = [
    ["yandex", "Я", "Яндекс", "#FC3F1D", "#fff"],
    ["google", "G", "Google", "#fff", "#4285F4"],
    ["mailru", "@", "Mail.ru", "#005FF9", "#fff"],
  ];
  const linked = me.linked_providers || [];

  return (
    <div
      style={{ padding: "12px 16px calc(env(safe-area-inset-bottom) + 80px)" }}
    >
      <SectionHead title="Личные данные" />
      <div style={rowStyle(0)}>
        <span style={lbl}>Имя</span>
        <input
          value={acc.first_name}
          onChange={(e) => set("first_name", e.target.value)}
          placeholder="—"
          aria-label="Имя"
          style={fin}
        />
      </div>
      <div style={rowStyle(1)}>
        <span style={lbl}>Фамилия</span>
        <input
          value={acc.last_name}
          onChange={(e) => set("last_name", e.target.value)}
          placeholder="—"
          aria-label="Фамилия"
          style={fin}
        />
      </div>
      <div style={rowStyle(0)}>
        <span style={lbl}>Email</span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 6,
            fontSize: 13,
            color: C.gray,
            fontFamily: FONT,
          }}
        >
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {me.email || "—"}
          </span>
          {me.is_email_verified && (
            <span
              title="подтверждён"
              style={{ color: "#15803D", fontSize: 12, flexShrink: 0 }}
            >
              ✓
            </span>
          )}
        </span>
      </div>
      <div style={rowStyle(1)}>
        <span style={lbl}>Телефон</span>
        <input
          value={acc.phone}
          onChange={(e) => set("phone", formatPhone(e.target.value))}
          inputMode="tel"
          placeholder="+7 ___ ___ __ __"
          aria-label="Телефон"
          style={{ ...fin, fontVariantNumeric: "tabular-nums" }}
        />
      </div>
      <div style={rowStyle(0)}>
        <span style={lbl}>Табельный №</span>
        <input
          value={acc.employee_number}
          onChange={(e) => set("employee_number", e.target.value)}
          placeholder="—"
          aria-label="Табельный номер"
          style={{ ...fin, fontVariantNumeric: "tabular-nums" }}
        />
      </div>
      {err && (
        <div
          style={{
            color: C.cherry,
            fontSize: 13,
            fontFamily: FONT,
            marginTop: 10,
          }}
        >
          {err}
        </div>
      )}
      <div style={{ marginTop: err ? 8 : 14 }}>
        <Btn full onClick={save}>
          Сохранить
        </Btn>
      </div>

      <SectionHead title="Ваша роль" />
      <div
        style={{
          background: C.white,
          border: `1px solid ${C.silver}`,
          borderRadius: 8,
          borderLeft: `3px solid ${C.cherry}`,
          padding: "12px 14px",
        }}
      >
        <span
          style={{
            display: "inline-block",
            background: C.cherryL,
            color: C.cherry,
            fontFamily: FONT,
            fontSize: 12,
            fontWeight: 700,
            padding: "3px 10px",
            borderRadius: 20,
          }}
        >
          {roleLabel(role)}
        </span>
        <div
          style={{
            fontFamily: FONT,
            fontSize: 12,
            color: C.gray,
            lineHeight: 1.5,
            marginTop: 8,
          }}
        >
          {roleDesc}
        </div>
      </div>
      <div
        style={{ fontSize: 11, color: C.grayL, fontFamily: FONT, marginTop: 6 }}
      >
        Роль изменяется Администратором на вкладке «Пользователи»
      </div>

      <SectionHead title="Безопасность" />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: C.white,
          border: `1px solid ${C.silver}`,
          borderRadius: 8,
          padding: "12px 14px",
          marginBottom: 14,
        }}
      >
        <span style={{ fontFamily: FONT, fontSize: 14, color: C.dark }}>
          Пароль ••••••••
        </span>
        <button
          onClick={() => setShowPwModal(true)}
          style={{
            border: `1px solid ${C.silver}`,
            background: C.white,
            borderRadius: 8,
            padding: "7px 14px",
            fontFamily: FONT,
            fontSize: 13,
            color: C.cherry,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Изменить
        </button>
      </div>
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: C.gray,
          fontFamily: FONT,
          marginBottom: 8,
        }}
      >
        Привязанные аккаунты
      </div>
      {PROVIDERS.map(([key, icon, name, bg, fg]) => {
        const isLinked = linked.includes(key);
        return (
          <div
            key={key}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: C.white,
              border: `1px solid ${C.silver}`,
              borderRadius: 8,
              padding: "8px 12px",
              marginBottom: 6,
            }}
          >
            <span
              style={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                background: bg,
                color: fg,
                border: bg === "#fff" ? `1px solid ${C.silver}` : "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: FONT,
                fontSize: 14,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {icon}
            </span>
            <span
              style={{ flex: 1, fontFamily: FONT, fontSize: 14, color: C.dark }}
            >
              {name}
            </span>
            <button
              onClick={oauthSoon}
              style={{
                border: `1px solid ${C.silver}`,
                background: C.white,
                borderRadius: 8,
                padding: "6px 12px",
                fontFamily: FONT,
                fontSize: 13,
                color: isLinked ? C.cherry : C.gray,
                cursor: "pointer",
              }}
            >
              {isLinked ? "Отвязать" : "Привязать"}
            </button>
          </div>
        );
      })}

      {consent && (
        <>
          <SectionHead title="Согласие на обработку данных" />
          <div
            style={{
              background: C.white,
              border: `1px solid ${C.silver}`,
              borderRadius: 8,
              padding: "12px 14px",
            }}
          >
            <div
              style={{
                fontFamily: FONT,
                fontSize: 13,
                color: C.dark,
                lineHeight: 1.5,
              }}
            >
              Согласие дано{" "}
              {consent.given_at
                ? new Date(consent.given_at).toLocaleDateString("ru-RU")
                : "—"}{" "}
              · Политика конфиденциальности v{consent.policy_version}
            </div>
            <button
              onClick={() => alert(CONSENT_TEXT)}
              style={{
                marginTop: 8,
                background: "none",
                border: "none",
                color: C.cherry,
                fontFamily: FONT,
                fontSize: 13,
                cursor: "pointer",
                padding: 0,
              }}
            >
              Посмотреть текст согласия
            </button>
          </div>
        </>
      )}

      <div style={{ marginTop: 24 }}>
        <button
          onClick={logout}
          style={{
            width: "100%",
            padding: "12px",
            background: C.white,
            border: `1.5px solid ${C.cherry}`,
            borderRadius: 10,
            fontFamily: FONT,
            fontSize: 14,
            fontWeight: 600,
            color: C.cherry,
            cursor: "pointer",
          }}
        >
          Выйти из аккаунта
        </button>
      </div>

      {saved && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            bottom: 90,
            transform: "translateX(-50%)",
            background: "#15803D",
            color: "#fff",
            padding: "10px 18px",
            borderRadius: 10,
            fontFamily: FONT,
            fontSize: 13,
            fontWeight: 600,
            zIndex: 400,
            boxShadow: "0 6px 16px rgba(0,0,0,0.2)",
          }}
        >
          Сохранено ✓
        </div>
      )}
      {showPwModal && (
        <ChangePasswordModal onClose={() => setShowPwModal(false)} />
      )}
    </div>
  );
}

function InviteSheet({ onClose }) {
  const [role, setRole] = useState("employee");
  const [hours, setHours] = useState(null); // null = бессрочная (по умолчанию)
  const [maxUses, setMaxUses] = useState(1);
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const ROLE_CHIPS = [
    ["employee", "Сотрудник"],
    ["manager", "Руководитель"],
    ["accountant", "Бухгалтер"],
  ];
  const TTL_CHIPS = [
    [24, "1 день"],
    [168, "7 дней"],
    [720, "30 дней"],
    [null, "Бессрочная"],
  ];
  const USE_CHIPS = [
    [1, "Одноразовая"],
    [999, "Многоразовая"],
  ];
  const chip = (on) => ({
    padding: "6px 12px",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: on ? 600 : 500,
    background: on ? "#A4161A" : "#EEF0F4",
    color: on ? "#fff" : "#636B7D",
  });
  const lbl = {
    fontSize: 10,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: C.gray,
    fontFamily: FONT,
    marginBottom: 8,
  };
  async function create() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await authFetch("/api/invite/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, expires_hours: hours, max_uses: maxUses }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d && d.invite_url) setCreated(d);
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(created.invite_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }
  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Приглашение в AOCG AI Офис",
          url: created.invite_url,
        });
      } else {
        copy();
      }
    } catch {
      /* cancelled */
    }
  }
  const dialogRef = useModalA11y(onClose);
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.3)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 300,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Ссылка-приглашение"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.white,
          width: "100%",
          maxWidth: 480,
          borderRadius: "16px 16px 0 0",
          display: "flex",
          flexDirection: "column",
          maxHeight: "88dvh",
          paddingBottom: "env(safe-area-inset-bottom)",
          outline: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "8px 0 2px",
          }}
        >
          <div
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              background: "#D5D7DD",
            }}
          />
        </div>
        <div
          style={{
            padding: "4px 16px 12px",
            borderBottom: `1px solid ${C.silver}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: 15,
              fontFamily: FONT,
              color: C.dark,
              fontWeight: 600,
            }}
          >
            Ссылка-приглашение
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            style={{
              border: "none",
              background: "none",
              color: C.gray,
              fontSize: 18,
              cursor: "pointer",
            }}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <div style={{ padding: "16px", overflow: "auto" }}>
          {!created ? (
            <>
              <div style={lbl}>Роль</div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginBottom: 16,
                }}
              >
                {ROLE_CHIPS.map(([v, l]) => (
                  <button
                    key={v}
                    onClick={() => setRole(v)}
                    style={chip(role === v)}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <div style={lbl}>Срок действия</div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginBottom: 16,
                }}
              >
                {TTL_CHIPS.map(([v, l]) => (
                  <button
                    key={l}
                    onClick={() => setHours(v)}
                    style={chip(hours === v)}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <div style={lbl}>Использований</div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginBottom: 20,
                }}
              >
                {USE_CHIPS.map(([v, l]) => (
                  <button
                    key={v}
                    onClick={() => setMaxUses(v)}
                    style={chip(maxUses === v)}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <Btn full onClick={create} disabled={busy}>
                {busy ? "Создаём…" : "Создать"}
              </Btn>
            </>
          ) : (
            <>
              <div
                style={{
                  fontSize: 13,
                  color: C.gray,
                  fontFamily: FONT,
                  marginBottom: 8,
                }}
              >
                Ссылка готова — отправьте сотруднику:
              </div>
              <div
                style={{
                  background: C.lightGray,
                  border: `1px solid ${C.silver}`,
                  borderRadius: 10,
                  padding: "10px 12px",
                  fontSize: 12,
                  color: C.dark,
                  fontFamily: "monospace",
                  wordBreak: "break-all",
                  marginBottom: 14,
                }}
              >
                {created.invite_url}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={copy}
                  style={{
                    flex: 1,
                    padding: "12px",
                    background: C.white,
                    border: `1px solid ${C.silver}`,
                    borderRadius: 10,
                    fontFamily: FONT,
                    fontSize: 13,
                    fontWeight: 600,
                    color: C.dark,
                    cursor: "pointer",
                  }}
                >
                  {copied ? "Скопировано ✓" : "📋 Скопировать"}
                </button>
                <button
                  onClick={share}
                  style={{
                    flex: 1,
                    padding: "12px",
                    background: C.cherry,
                    border: "none",
                    borderRadius: 10,
                    fontFamily: FONT,
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#fff",
                    cursor: "pointer",
                  }}
                >
                  ↗ Поделиться
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── D2: управление справочником категорий (Настройки → Общие) ───
const FIELD_LBL = {
  display: "block",
  fontSize: 11,
  color: C.gray,
  fontFamily: FONT,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  margin: "12px 0 4px",
};
const FIELD_INP = {
  width: "100%",
  boxSizing: "border-box",
  border: `1px solid ${C.silver}`,
  borderRadius: 8,
  padding: "9px 11px",
  fontSize: 14,
  fontFamily: FONT,
  color: C.dark,
  background: C.white,
  outline: "none",
};

// Переиспользуемая нижняя шторка — тот же паттерн анимации, что у CategorySheet (D1).
function BottomSheet({ title, onClose, children }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
  const close = () => {
    setShown(false);
    setTimeout(onClose, 220);
  };
  const dialogRef = useModalA11y(close);
  return (
    <div
      onClick={close}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.3)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 170,
        opacity: shown ? 1 : 0,
        transition: `opacity ${shown ? 280 : 220}ms ease`,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.white,
          width: "100%",
          maxWidth: 480,
          borderRadius: "16px 16px 0 0",
          outline: "none",
          display: "flex",
          flexDirection: "column",
          maxHeight: "88dvh",
          paddingBottom: "env(safe-area-inset-bottom)",
          transform: shown ? "translateY(0)" : "translateY(100%)",
          transition: `transform ${shown ? 280 : 220}ms ${EASE}`,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "8px 0 2px",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              background: "#D5D7DD",
            }}
          />
        </div>
        <div
          style={{
            padding: "4px 16px 12px",
            borderBottom: `1px solid ${C.silver}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 15,
              fontFamily: FONT,
              color: C.dark,
              fontWeight: 600,
            }}
          >
            {title}
          </span>
          <button
            type="button"
            onClick={close}
            aria-label="Закрыть"
            style={{
              border: "none",
              background: "none",
              color: C.gray,
              fontSize: 18,
              cursor: "pointer",
            }}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <div style={{ padding: "12px 16px 20px", overflow: "auto", flex: 1 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function ActionRow({ children, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "14px 6px",
        border: "none",
        borderBottom: `1px solid ${C.silver}`,
        background: "none",
        fontFamily: FONT,
        fontSize: 14,
        color: danger ? C.cherry : C.dark,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

// Форма добавления/переименования статьи. Сама делает POST/PATCH; ошибки бэка
// (409 дубль, 400 tax_kind) показывает инлайн; при успехе → onSaved(msg)+закрытие.
function CategoryFormSheet({ mode, group, groups, cat, onClose, onSaved }) {
  const [name, setName] = useState(mode === "edit" ? cat.name : "");
  const [groupId, setGroupId] = useState(
    mode === "create" ? (group ? group.id : groups[0] && groups[0].id) : null,
  );
  const [taxKind, setTaxKind] = useState(
    mode === "edit" ? cat.tax_kind || "Прочие расходы" : "Прочие расходы",
  );
  const [advOpen, setAdvOpen] = useState(false);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const nm = name.trim();
    if (!nm) {
      setErr("Введите название");
      return;
    }
    setSaving(true);
    setErr("");
    let res;
    if (mode === "edit")
      res = await authFetch(`/api/categories/${cat.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nm, tax_kind: taxKind }),
      });
    else
      res = await authFetch(`/api/categories/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nm,
          group_id: groupId,
          tax_kind: taxKind,
        }),
      });
    setSaving(false);
    if (res.ok) {
      onSaved(mode === "edit" ? "Статья сохранена" : "Статья добавлена");
      return;
    }
    if (res.status === 409) {
      setErr("Статья с таким названием уже существует");
      return;
    }
    if (res.status === 400) {
      setErr("Недопустимый вид расхода");
      return;
    }
    setErr("Не удалось сохранить, попробуйте ещё раз");
  };
  return (
    <BottomSheet
      title={mode === "edit" ? "Переименовать статью" : "Новая статья"}
      onClose={onClose}
    >
      <label style={FIELD_LBL}>Название</label>
      <input
        autoFocus={mode === "create"}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Например: Подписки на сервисы"
        aria-label="Название статьи"
        style={FIELD_INP}
      />
      <label style={FIELD_LBL}>Группа</label>
      {mode === "edit" ? (
        <div style={{ ...FIELD_INP, color: C.gray, background: C.lightGray }}>
          {group ? group.name : "—"}
        </div>
      ) : (
        <select
          value={groupId}
          onChange={(e) => setGroupId(Number(e.target.value))}
          style={FIELD_INP}
        >
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      )}
      <button
        onClick={() => setAdvOpen((o) => !o)}
        style={{
          border: "none",
          background: "none",
          color: C.gray,
          fontSize: 12,
          fontFamily: FONT,
          cursor: "pointer",
          padding: "12px 0 2px",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span
          style={{
            transform: advOpen ? "rotate(90deg)" : "none",
            transition: "transform 0.15s",
            display: "inline-block",
          }}
        >
          ›
        </span>{" "}
        Расширенные настройки
      </button>
      {advOpen && (
        <div>
          <label style={FIELD_LBL}>Вид расхода для налогов</label>
          <select
            value={taxKind}
            onChange={(e) => setTaxKind(e.target.value)}
            style={FIELD_INP}
          >
            {TAX_KINDS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <div
            style={{
              fontSize: 11,
              color: C.grayL,
              fontFamily: FONT,
              marginTop: 5,
              lineHeight: 1.4,
            }}
          >
            Это поле для бухгалтера. Если не уверены — оставьте «Прочие
            расходы».
          </div>
        </div>
      )}
      {err && (
        <div
          style={{
            fontSize: 12,
            color: C.cherry,
            fontFamily: FONT,
            marginTop: 10,
          }}
        >
          {err}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
        <Btn full loading={saving} onClick={save}>
          Сохранить
        </Btn>
        <Btn full outline onClick={onClose}>
          Отменить
        </Btn>
      </div>
    </BottomSheet>
  );
}

// Аккордеон 11 групп со статьями; CRUD над статьёй — через шторки действий/формы.
function CategoriesSection({ catalog, onCatalogRefresh }) {
  const [expanded, setExpanded] = useState({});
  const [actionCat, setActionCat] = useState(null); // {cat, group}
  const [form, setForm] = useState(null); // {mode, group, cat?}
  const [blocked, setBlocked] = useState(null); // {cat, count}
  const [toast, setToast] = useState("");
  const groups = catalog?.groups || [];
  const refresh = () => {
    if (onCatalogRefresh) onCatalogRefresh();
  };
  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2200);
  };

  const toggleVisibility = async (cat) => {
    const next = !(cat.is_visible !== false); // сейчас видимая → скрываем
    const res = await authFetch(`/api/categories/${cat.id}/visibility`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_visible: next }),
    });
    setActionCat(null);
    if (res.ok) {
      refresh();
      showToast(next ? "Статья показана" : "Статья скрыта");
    } else showToast("Не удалось изменить видимость");
  };
  const doDelete = async (cat) => {
    const res = await authFetch(`/api/categories/${cat.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setActionCat(null);
      refresh();
      showToast("Статья удалена");
      return;
    }
    if (res.status === 409) {
      const body = await res.json().catch(() => null);
      const detail = body && body.detail;
      if (detail && detail.code === "category_has_receipts") {
        setActionCat(null);
        setBlocked({ cat, count: detail.count });
        return;
      }
    }
    showToast("Не удалось удалить");
  };
  const hideFromBlocked = async (cat) => {
    const res = await authFetch(`/api/categories/${cat.id}/visibility`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_visible: false }),
    });
    setBlocked(null);
    if (res.ok) {
      refresh();
      showToast("Статья скрыта");
    } else showToast("Не удалось скрыть");
  };

  return (
    <div>
      {groups.map((g) => {
        const col = groupColor(g.name);
        const open = !!expanded[g.id];
        const cats = g.categories || [];
        return (
          <div
            key={g.id}
            style={{
              marginBottom: 8,
              border: `1px solid ${C.silver}`,
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            <div
              onClick={() => setExpanded((e) => ({ ...e, [g.id]: !e[g.id] }))}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "11px 12px",
                cursor: "pointer",
                background: C.white,
              }}
            >
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  background: col.fg,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  flex: 1,
                  fontSize: 13,
                  fontWeight: 600,
                  color: C.dark,
                  fontFamily: FONT,
                }}
              >
                {g.name}
              </span>
              <span style={{ fontSize: 11, color: C.grayL, fontFamily: FONT }}>
                {cats.length}
              </span>
              <span
                style={{
                  fontSize: 14,
                  color: C.gray,
                  transform: open ? "rotate(90deg)" : "none",
                  transition: "transform 0.15s",
                  display: "inline-block",
                }}
              >
                ›
              </span>
            </div>
            {open && (
              <div style={{ background: C.lightGray, padding: "2px 0 8px" }}>
                {cats.map((c) => {
                  const hidden = c.is_visible === false;
                  return (
                    <div
                      key={c.id}
                      onClick={() => setActionCat({ cat: c, group: g })}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "9px 14px",
                        cursor: "pointer",
                        opacity: hidden ? 0.5 : 1,
                      }}
                    >
                      <span
                        style={{
                          flex: 1,
                          fontSize: 13,
                          color: C.dark,
                          fontFamily: FONT,
                          textDecoration: hidden ? "line-through" : "none",
                        }}
                      >
                        {c.name}
                      </span>
                      {c.is_default && (
                        <span
                          title="Системная статья"
                          style={{ fontSize: 11, flexShrink: 0 }}
                        >
                          🔒
                        </span>
                      )}
                      <span
                        style={{ fontSize: 13, color: C.grayL, flexShrink: 0 }}
                      >
                        ›
                      </span>
                    </div>
                  );
                })}
                <div style={{ padding: "8px 14px 2px" }}>
                  <Btn
                    small
                    outline
                    onClick={() => setForm({ mode: "create", group: g })}
                  >
                    + Добавить статью
                  </Btn>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {actionCat && (
        <BottomSheet
          title={actionCat.cat.name}
          onClose={() => setActionCat(null)}
        >
          {actionCat.cat.is_default ? (
            <ActionRow onClick={() => toggleVisibility(actionCat.cat)}>
              {actionCat.cat.is_visible === false ? "Показать" : "Скрыть"}
            </ActionRow>
          ) : (
            <>
              <ActionRow
                onClick={() => {
                  const g = actionCat.group,
                    c = actionCat.cat;
                  setActionCat(null);
                  setForm({ mode: "edit", group: g, cat: c });
                }}
              >
                Переименовать
              </ActionRow>
              <ActionRow onClick={() => toggleVisibility(actionCat.cat)}>
                {actionCat.cat.is_visible === false ? "Показать" : "Скрыть"}
              </ActionRow>
              <ActionRow danger onClick={() => doDelete(actionCat.cat)}>
                Удалить
              </ActionRow>
            </>
          )}
        </BottomSheet>
      )}

      {form && (
        <CategoryFormSheet
          mode={form.mode}
          group={form.group}
          groups={groups}
          cat={form.cat}
          onClose={() => setForm(null)}
          onSaved={(msg) => {
            setForm(null);
            refresh();
            showToast(msg);
          }}
        />
      )}

      {blocked && (
        <BottomSheet title="Нельзя удалить" onClose={() => setBlocked(null)}>
          <div
            style={{
              fontSize: 14,
              color: C.dark,
              fontFamily: FONT,
              lineHeight: 1.5,
            }}
          >
            К статье «{blocked.cat.name}» привязано {blocked.count}{" "}
            {plural(blocked.count, ["чек", "чека", "чеков"])}. Их категория не
            будет потеряна — но если статья вам больше не нужна, её можно
            скрыть.
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
            <Btn full onClick={() => hideFromBlocked(blocked.cat)}>
              Скрыть статью
            </Btn>
            <Btn full outline onClick={() => setBlocked(null)}>
              Отменить
            </Btn>
          </div>
        </BottomSheet>
      )}

      {toast && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            bottom: 90,
            transform: "translateX(-50%)",
            background: C.dark,
            color: C.white,
            padding: "10px 16px",
            borderRadius: 8,
            fontSize: 13,
            fontFamily: FONT,
            zIndex: 200,
            boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
            maxWidth: "90%",
            textAlign: "center",
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

function NastroykiPage({
  cards,
  onAddCard,
  onUpdateCard,
  onDeleteCard,
  onSetDefaultCard,
  users,
  onAddUser,
  onDeleteUser,
  role,
  catalog,
  onCatalogRefresh,
}) {
  const [tab, setTab] = useState("Аккаунт");
  const [newCard, setNewCard] = useState("");
  const [showAddEmp, setShowAddEmp] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [servicesList, setServicesList] = useState([]);
  const [invites, setInvites] = useState([]);
  const [copiedToken, setCopiedToken] = useState(null);

  const loadInvites = () =>
    authFetch(`/api/invite/list`)
      .then((r) => r.json())
      .then((d) => setInvites(Array.isArray(d) ? d : []))
      .catch(() => {});
  const delInvite = (token) =>
    authFetch(`/api/invite/${token}`, { method: "DELETE" })
      .then(() => loadInvites())
      .catch(() => {});
  const copyInvite = async (inv) => {
    try {
      await navigator.clipboard.writeText(inv.invite_url);
      setCopiedToken(inv.token);
      setTimeout(() => setCopiedToken(null), 1500);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    authFetch(`/api/services/`)
      .then((r) => r.json())
      .then((d) => setServicesList(Array.isArray(d) ? d : []))
      .catch(() => {});
    loadInvites();
  }, []);

  return (
    <div>
      <TabBar
        tabs={[
          "Аккаунт",
          "Организация",
          "Лицензии",
          "Пользователи",
          "Сервисы",
          "Общие",
        ]}
        active={tab}
        onSelect={setTab}
      />
      {tab === "Аккаунт" && <AccountTab />}
      {tab === "Организация" && (
        <OrganizationTab
          authFetch={authFetch}
          role={role}
          C={C}
          FONT={FONT}
          Btn={Btn}
          SectionHead={SectionHead}
          fmtDate={fmtDate}
        />
      )}
      {tab === "Лицензии" && (
        <div style={{ padding: "60px 24px", textAlign: "center" }}>
          <div style={{ fontFamily: FONT, fontSize: 13, color: C.grayL }}>
            Управление лицензиями — скоро
          </div>
        </div>
      )}
      {tab === "Пользователи" && (
        <div style={{ padding: "12px 16px 80px" }}>
          <SectionHead title="Сотрудники" />
          {users.map((u) => (
            <SwipeableUserRow
              key={u.id}
              user={u}
              deletable={u.id !== 1}
              onDelete={() => onDeleteUser(u.id)}
            />
          ))}
          {users.length === 0 && (
            <div
              style={{
                fontSize: 12,
                color: C.grayL,
                fontFamily: FONT,
                padding: "10px 0",
              }}
            >
              Пока нет сотрудников
            </div>
          )}
          <div style={{ marginTop: 18 }}>
            <SectionHead title="Ссылки-приглашения" />
            {invites.length === 0 && (
              <div
                style={{
                  fontSize: 12,
                  color: C.grayL,
                  fontFamily: FONT,
                  padding: "4px 2px",
                }}
              >
                Нет активных ссылок
              </div>
            )}
            {invites.map((inv) => (
              <div
                key={inv.token}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  background: C.white,
                  border: `1px solid ${C.silver}`,
                  borderRadius: 8,
                  padding: "10px 12px",
                  marginBottom: 6,
                }}
              >
                <span style={{ fontSize: 16, flexShrink: 0 }}>
                  {ROLE_ICON[inv.role] || "👤"}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      color: C.dark,
                      fontFamily: FONT,
                      fontWeight: 600,
                    }}
                  >
                    {roleLabel(inv.role)}
                  </div>
                  <div
                    style={{ fontSize: 11, color: C.gray, fontFamily: FONT }}
                  >
                    {inv.expires_at
                      ? new Date(inv.expires_at).toLocaleDateString("ru-RU")
                      : "Бессрочная"}{" "}
                    · {inv.uses_count}/
                    {inv.max_uses >= 999 ? "∞" : inv.max_uses} исп.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => copyInvite(inv)}
                  title="Скопировать"
                  aria-label="Скопировать ссылку-приглашение"
                  style={{
                    border: "none",
                    background: "none",
                    fontSize: 15,
                    cursor: "pointer",
                    flexShrink: 0,
                    padding: 4,
                    color: copiedToken === inv.token ? "#15803D" : C.gray,
                  }}
                >
                  <span aria-hidden="true">
                    {copiedToken === inv.token ? "✓" : "📋"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => delInvite(inv.token)}
                  title="Удалить"
                  aria-label="Удалить приглашение"
                  style={{
                    border: "none",
                    background: "none",
                    color: C.cherryM,
                    fontSize: 16,
                    cursor: "pointer",
                    flexShrink: 0,
                    padding: 4,
                  }}
                >
                  <span aria-hidden="true">✕</span>
                </button>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14 }}>
            <Btn full onClick={() => setShowAddEmp(true)}>
              + Добавить сотрудника
            </Btn>
          </div>
          <div style={{ marginTop: 10 }}>
            <Btn full outline onClick={() => setShowInvite(true)}>
              + Создать ссылку-приглашение
            </Btn>
          </div>
        </div>
      )}
      {tab === "Сервисы" && (
        <div style={{ padding: "12px 16px 80px" }}>
          <SectionHead title="Интеграции" />
          {servicesList.map((s) => (
            <ServiceCard key={s.key} svc={s} />
          ))}
          {servicesList.length === 0 && (
            <div
              style={{
                fontSize: 12,
                color: C.grayL,
                fontFamily: FONT,
                padding: "10px 0",
              }}
            >
              Загрузка…
            </div>
          )}
        </div>
      )}
      {tab === "Общие" && (
        <div style={{ padding: "12px 16px 80px" }}>
          <SectionHead title="Управление категориями" />
          {role === "admin" || role === "accountant" ? (
            <CategoriesSection
              catalog={catalog}
              onCatalogRefresh={onCatalogRefresh}
            />
          ) : (
            <div
              style={{
                padding: "12px 2px",
                color: C.gray,
                fontSize: 13,
                fontFamily: FONT,
                lineHeight: 1.5,
              }}
            >
              Управление категориями доступно администратору и бухгалтеру
            </div>
          )}
          <SectionHead title="Мои карты" />
          <div
            style={{
              fontSize: 11,
              color: C.gray,
              fontFamily: FONT,
              marginBottom: 8,
              lineHeight: 1.5,
            }}
          >
            При сканировании чека карта подставляется по истории трат в той же
            организации. Если истории нет — подставляется карта по умолчанию
            (отмечена ★).
          </div>
          {cards.map((c, i) => (
            <div
              key={c.id}
              style={{
                background: i % 2 === 0 ? C.white : C.lightGray,
                padding: "5px 14px",
                borderBottom: `1px solid ${C.silver}`,
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span
                onClick={() => {
                  if (!c.is_default) onSetDefaultCard(c.id);
                }}
                title={
                  c.is_default
                    ? "Карта по умолчанию"
                    : "Сделать картой по умолчанию"
                }
                style={{
                  fontSize: 16,
                  cursor: c.is_default ? "default" : "pointer",
                  flexShrink: 0,
                  color: c.is_default ? C.cherry : C.grayL,
                  lineHeight: 1,
                }}
              >
                {c.is_default ? "★" : "☆"}
              </span>
              <input
                defaultValue={c.name}
                aria-label="Название карты"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== c.name) onUpdateCard(c.id, v);
                  else e.target.value = c.name;
                }}
                style={{
                  flex: 1,
                  border: "none",
                  background: "transparent",
                  fontSize: 13,
                  fontFamily: FONT,
                  color: C.dark,
                  outline: "none",
                  padding: "4px 0",
                }}
              />
              <button
                type="button"
                onClick={() => onDeleteCard(c.id)}
                aria-label="Удалить карту"
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  color: C.cherryM,
                  fontSize: 14,
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>
          ))}
          {cards.length === 0 && (
            <div
              style={{
                fontSize: 12,
                color: C.grayL,
                fontFamily: FONT,
                padding: "8px 0",
              }}
            >
              Пока нет карт
            </div>
          )}
          <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
            <input
              value={newCard}
              onChange={(e) => setNewCard(e.target.value)}
              placeholder="Например: Личная Сбер"
              aria-label="Название новой карты"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newCard.trim()) {
                  onAddCard(newCard.trim());
                  setNewCard("");
                }
              }}
              style={{
                flex: 1,
                border: `1px solid ${C.silver}`,
                borderRadius: 6,
                outline: "none",
                padding: "7px 10px",
                fontSize: 13,
                fontFamily: FONT,
                color: C.dark,
                background: C.white,
                boxSizing: "border-box",
              }}
            />
            <Btn
              small
              onClick={() => {
                if (newCard.trim()) {
                  onAddCard(newCard.trim());
                  setNewCard("");
                }
              }}
            >
              + Добавить
            </Btn>
          </div>
          <div
            style={{
              marginTop: 28,
              paddingTop: 14,
              borderTop: `1px solid ${C.silver}`,
              fontSize: 10,
              color: C.grayL,
              fontFamily: FONT,
              textAlign: "center",
              letterSpacing: "0.04em",
            }}
          >
            Сборка от {__BUILD_TIME__}
          </div>
        </div>
      )}
      {showAddEmp && (
        <AddEmployeeSheet
          onClose={() => setShowAddEmp(false)}
          onAdd={onAddUser}
        />
      )}
      {showInvite && (
        <InviteSheet
          onClose={() => {
            setShowInvite(false);
            loadInvites();
          }}
        />
      )}
    </div>
  );
}

// ─── CONSENT (152-FZ) ──────────────────────────────────────────────
//
// On first launch we present an opt-in screen with two unchecked boxes
// (privacy policy + personal-data processing). Both must be ticked before
// "Продолжить" enables. Tapping each link opens a bottom-sheet with the
// frozen v1.0 text. The texts below are placeholders to be replaced by the
// final lawyer-reviewed version — both the wording and POLICY_VERSION live
// alongside the same constants on the backend (app/routers/consent.py).
const POLICY_VERSION = "1.0";

const POLICY_TEXT = `Политика конфиденциальности

Оператор персональных данных:
ИП Шукалович Алексей Иванович
ОГРНИП: 324470400135929 · ИНН: 470705591044

Мы собираем: ФИО сотрудников, номера телефонов,
данные финансовых операций.

Цель: ведение управленческого учёта в приложении
AOCG AI Офис.

Обработчики данных:
• Railway Inc. (США) — хостинг и база данных
• Anthropic PBC (США) — распознавание фото чеков.
  Anthropic не хранит изображения и не использует
  их для обучения моделей.

Срок хранения: 5 лет.

Вы вправе отозвать согласие в Настройках.

[PLACEHOLDER — финальная редакция юриста]`;

const CONSENT_TEXT = `Согласие на обработку персональных данных

Я даю согласие ИП Шукалович Алексей Иванович
(ОГРНИП: 324470400135929, ИНН: 470705591044)
на обработку следующих персональных данных:
ФИО, номер телефона, данные о финансовых операциях —
в целях ведения управленческого учёта.

Я уведомлён, что для распознавания фото чеков
изображения передаются сервису Anthropic PBC (США)
и не сохраняются третьими лицами.

Согласие даётся на срок 5 лет и может быть
отозвано в Настройках приложения.

Версия: ${POLICY_VERSION} от 20.05.2026

[PLACEHOLDER — финальная редакция юриста]`;

function ConsentBottomSheet({ title, text, onClose }) {
  const dialogRef = useModalA11y(onClose);
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(22,26,29,0.5)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 300,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.white,
          width: "100%",
          maxWidth: 480,
          maxHeight: "80dvh",
          borderRadius: "16px 16px 0 0",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          paddingBottom: "env(safe-area-inset-bottom)",
          outline: "none",
        }}
      >
        <div
          style={{
            padding: "14px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: `1px solid ${C.silver}`,
          }}
        >
          <span
            style={{
              fontFamily: FONT,
              fontSize: 14,
              fontWeight: 600,
              color: C.dark,
            }}
          >
            {title}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            style={{
              border: "none",
              background: "none",
              color: C.gray,
              cursor: "pointer",
              fontSize: 20,
              padding: 4,
              lineHeight: 1,
            }}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <div
          style={{
            overflow: "auto",
            padding: "16px 18px",
            fontFamily: FONT,
            fontSize: 13,
            color: C.dark,
            lineHeight: 1.55,
            whiteSpace: "pre-wrap",
          }}
        >
          {text}
        </div>
        <div
          style={{
            padding: "12px 16px",
            borderTop: `1px solid ${C.silver}`,
            background: C.lightGray,
          }}
        >
          <button
            onClick={onClose}
            style={{
              width: "100%",
              padding: "12px",
              background: C.white,
              border: `1px solid ${C.silver}`,
              borderRadius: 10,
              fontFamily: FONT,
              fontSize: 13,
              color: C.dark,
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}

function ConsentCheckbox({ checked, onToggleCheck, onOpenSheet, label }) {
  // Two distinct hit-targets:
  //   - the box itself toggles the checkbox
  //   - the label opens the corresponding bottom-sheet
  // This matches the spec: "тап на текст открывает bottom-sheet". Checking
  // the box requires an explicit, separate action.
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "4px 0",
      }}
    >
      <button
        onClick={onToggleCheck}
        aria-pressed={checked}
        aria-label="Отметить"
        style={{
          flexShrink: 0,
          width: 22,
          height: 22,
          marginTop: 1,
          borderRadius: 5,
          border: `1.5px solid ${checked ? C.cherry : C.silver}`,
          background: checked ? C.cherry : C.white,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          transition: "all 120ms ease",
          padding: 0,
        }}
      >
        {checked && (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fff"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </button>
      <button
        onClick={onOpenSheet}
        style={{
          flex: 1,
          textAlign: "left",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          fontFamily: FONT,
          fontSize: 13,
          color: C.dark,
          lineHeight: 1.45,
        }}
      >
        {label}
      </button>
    </div>
  );
}

function ConsentScreen({ onAccept }) {
  const [policyChecked, setPolicyChecked] = useState(false);
  const [dataChecked, setDataChecked] = useState(false);
  const [sheet, setSheet] = useState(null); // null | "policy" | "consent"
  const [submitting, setSubmitting] = useState(false);
  const canSubmit = policyChecked && dataChecked && !submitting;

  async function handleAccept() {
    if (!canSubmit) return;
    setSubmitting(true);
    // POST is best-effort: if the server is down we still persist locally so
    // the user isn't locked out. A future sync job (or settings screen) can
    // re-post when connectivity returns.
    try {
      await authFetch(`/api/consent/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: "local_user", ip_address: null }),
      });
    } catch {
      /* network failure tolerated */
    }
    try {
      localStorage.setItem("consent_given", "true");
      localStorage.setItem("consent_version", POLICY_VERSION);
      localStorage.setItem("consent_at", new Date().toISOString());
    } catch {
      /* private mode / storage disabled */
    }
    onAccept();
  }

  return (
    <div
      style={{
        maxWidth: 480,
        margin: "0 auto",
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        background: C.light,
        fontFamily: FONT,
        padding:
          "calc(env(safe-area-inset-top) + 48px) 24px calc(env(safe-area-inset-bottom) + 24px)",
      }}
    >
      {/* Logo */}
      <div
        style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            background: "#fff",
            border: `1px solid ${C.silver}`,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg
            width="60"
            height="14"
            viewBox="0 0 770 180"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M286.511 0C304.22 2.1117e-07 321.53 5.25113 336.254 15.0893C350.978 24.9276 362.454 38.911 369.231 55.2714C376.008 71.6317 377.781 89.6342 374.326 107.002C370.871 124.37 362.344 140.324 349.822 152.846C337.3 165.367 321.347 173.895 303.979 177.349C286.611 180.804 268.608 179.031 252.248 172.254C235.888 165.478 221.904 154.002 212.066 139.278C202.228 124.554 196.977 107.243 196.977 89.5349H230.233C230.233 100.666 233.534 111.546 239.718 120.801C245.902 130.056 254.691 137.269 264.975 141.529C275.258 145.788 286.574 146.903 297.491 144.731C308.408 142.56 318.435 137.2 326.306 129.329C334.177 121.459 339.537 111.431 341.708 100.514C343.88 89.5973 342.765 78.2817 338.506 67.9982C334.246 57.7147 327.033 48.9253 317.778 42.7414C308.523 36.5575 297.642 33.2569 286.511 33.2569V0Z"
              fill="#161A1D"
            />
            <path
              d="M483.489 179.07C465.78 179.07 448.47 173.819 433.746 163.98C419.022 154.142 407.546 140.159 400.769 123.798C393.992 107.438 392.219 89.4357 395.674 72.0676C399.129 54.6995 407.656 38.7459 420.178 26.2243C432.7 13.7026 448.653 5.17523 466.021 1.7205C483.389 -1.73421 501.392 0.0388551 517.752 6.81554C534.112 13.5922 548.096 25.0681 557.934 39.7921C567.772 54.516 573.023 71.8266 573.023 89.535L539.767 89.535C539.767 78.4042 536.466 67.5235 530.282 58.2686C524.098 49.0137 515.309 41.8004 505.025 37.5409C494.742 33.2813 483.426 32.1668 472.509 34.3383C461.592 36.5098 451.565 41.8698 443.694 49.7404C435.823 57.611 430.463 67.6388 428.292 78.5557C426.12 89.4725 427.235 100.788 431.494 111.072C435.754 121.355 442.967 130.145 452.222 136.328C461.477 142.512 472.358 145.813 483.489 145.813L483.489 179.07Z"
              fill="#161A1D"
            />
            <path
              d="M770 89.5349C770 107.243 764.749 124.554 754.911 139.278C745.072 154.002 731.089 165.478 714.729 172.254C698.368 179.031 680.366 180.804 662.998 177.349C645.63 173.895 629.676 165.367 617.154 152.846C604.633 140.324 596.105 124.37 592.651 107.002C589.196 89.6342 590.969 71.6317 597.746 55.2713C604.522 38.911 615.998 24.9276 630.722 15.0893C645.446 5.25112 662.757 -5.11009e-06 680.465 -3.91369e-06L680.465 33.2569C669.334 33.2569 658.454 36.5575 649.199 42.7414C639.944 48.9253 632.731 57.7147 628.471 67.9982C624.211 78.2817 623.097 89.5973 625.269 100.514C627.44 111.431 632.8 121.459 640.671 129.329C648.541 137.2 658.569 142.56 669.486 144.731C680.403 146.903 691.718 145.788 702.002 141.529C712.285 137.269 721.075 130.056 727.259 120.801C733.442 111.546 736.743 100.666 736.743 89.5349L770 89.5349Z"
              fill="#161A1D"
            />
            <path
              d="M71.6279 0L0 179.07H35.814L89.5349 44.7674L143.256 179.07H179.07L107.442 0H71.6279Z"
              fill="#A4161A"
            />
          </svg>
        </div>
      </div>

      <h1
        style={{
          fontFamily: FONT,
          fontSize: 22,
          fontWeight: 700,
          color: C.dark,
          textAlign: "center",
          margin: "0 0 8px",
          lineHeight: 1.25,
        }}
      >
        Добро пожаловать в AOCG AI Офис
      </h1>
      <p
        style={{
          fontFamily: FONT,
          fontSize: 14,
          color: C.gray,
          textAlign: "center",
          margin: "0 0 32px",
          lineHeight: 1.45,
        }}
      >
        Перед началом работы ознакомьтесь с документами
      </p>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          marginBottom: 32,
        }}
      >
        <ConsentCheckbox
          checked={policyChecked}
          onToggleCheck={() => setPolicyChecked((v) => !v)}
          onOpenSheet={() => setSheet("policy")}
          label={
            <>
              Я ознакомился и согласен с{" "}
              <span style={{ color: C.cherry, textDecoration: "underline" }}>
                Политикой конфиденциальности
              </span>
            </>
          }
        />
        <ConsentCheckbox
          checked={dataChecked}
          onToggleCheck={() => setDataChecked((v) => !v)}
          onOpenSheet={() => setSheet("consent")}
          label={
            <>
              Я даю{" "}
              <span style={{ color: C.cherry, textDecoration: "underline" }}>
                согласие на обработку моих персональных данных
              </span>{" "}
              в соответствии с 152-ФЗ
            </>
          }
        />
      </div>

      <div style={{ marginTop: "auto" }}>
        <button
          onClick={handleAccept}
          disabled={!canSubmit}
          style={{
            width: "100%",
            padding: "14px",
            border: "none",
            borderRadius: 12,
            background: canSubmit ? C.cherry : C.lightGray,
            color: canSubmit ? C.white : C.grayL,
            fontFamily: FONT,
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: "0.03em",
            cursor: canSubmit ? "pointer" : "default",
            transition: "background 150ms",
          }}
        >
          {submitting ? "Сохраняем…" : "Продолжить"}
        </button>
      </div>

      {sheet === "policy" && (
        <ConsentBottomSheet
          title="Политика конфиденциальности"
          text={POLICY_TEXT}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "consent" && (
        <ConsentBottomSheet
          title="Согласие на обработку ПДн"
          text={CONSENT_TEXT}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

// ─── AUTH SCREENS ───────────────────────────────────────────
function AocgLogo({ width, height }) {
  const w = height ? (height * 770) / 180 : width || 140;
  const h = height || ((width || 140) * 180) / 770;
  return (
    <svg
      width={w}
      height={h}
      viewBox="0 0 770 180"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M286.511 0C304.22 2.1117e-07 321.53 5.25113 336.254 15.0893C350.978 24.9276 362.454 38.911 369.231 55.2714C376.008 71.6317 377.781 89.6342 374.326 107.002C370.871 124.37 362.344 140.324 349.822 152.846C337.3 165.367 321.347 173.895 303.979 177.349C286.611 180.804 268.608 179.031 252.248 172.254C235.888 165.478 221.904 154.002 212.066 139.278C202.228 124.554 196.977 107.243 196.977 89.5349H230.233C230.233 100.666 233.534 111.546 239.718 120.801C245.902 130.056 254.691 137.269 264.975 141.529C275.258 145.788 286.574 146.903 297.491 144.731C308.408 142.56 318.435 137.2 326.306 129.329C334.177 121.459 339.537 111.431 341.708 100.514C343.88 89.5973 342.765 78.2817 338.506 67.9982C334.246 57.7147 327.033 48.9253 317.778 42.7414C308.523 36.5575 297.642 33.2569 286.511 33.2569V0Z"
        fill="#161A1D"
      />
      <path
        d="M483.489 179.07C465.78 179.07 448.47 173.819 433.746 163.98C419.022 154.142 407.546 140.159 400.769 123.798C393.992 107.438 392.219 89.4357 395.674 72.0676C399.129 54.6995 407.656 38.7459 420.178 26.2243C432.7 13.7026 448.653 5.17523 466.021 1.7205C483.389 -1.73421 501.392 0.0388551 517.752 6.81554C534.112 13.5922 548.096 25.0681 557.934 39.7921C567.772 54.516 573.023 71.8266 573.023 89.535L539.767 89.535C539.767 78.4042 536.466 67.5235 530.282 58.2686C524.098 49.0137 515.309 41.8004 505.025 37.5409C494.742 33.2813 483.426 32.1668 472.509 34.3383C461.592 36.5098 451.565 41.8698 443.694 49.7404C435.823 57.611 430.463 67.6388 428.292 78.5557C426.12 89.4725 427.235 100.788 431.494 111.072C435.754 121.355 442.967 130.145 452.222 136.328C461.477 142.512 472.358 145.813 483.489 145.813L483.489 179.07Z"
        fill="#161A1D"
      />
      <path
        d="M770 89.5349C770 107.243 764.749 124.554 754.911 139.278C745.072 154.002 731.089 165.478 714.729 172.254C698.368 179.031 680.366 180.804 662.998 177.349C645.63 173.895 629.676 165.367 617.154 152.846C604.633 140.324 596.105 124.37 592.651 107.002C589.196 89.6342 590.969 71.6317 597.746 55.2713C604.522 38.911 615.998 24.9276 630.722 15.0893C645.446 5.25112 662.757 -5.11009e-06 680.465 -3.91369e-06L680.465 33.2569C669.334 33.2569 658.454 36.5575 649.199 42.7414C639.944 48.9253 632.731 57.7147 628.471 67.9982C624.211 78.2817 623.097 89.5973 625.269 100.514C627.44 111.431 632.8 121.459 640.671 129.329C648.541 137.2 658.569 142.56 669.486 144.731C680.403 146.903 691.718 145.788 702.002 141.529C712.285 137.269 721.075 130.056 727.259 120.801C733.442 111.546 736.743 100.666 736.743 89.5349L770 89.5349Z"
        fill="#161A1D"
      />
      <path
        d="M71.6279 0L0 179.07H35.814L89.5349 44.7674L143.256 179.07H179.07L107.442 0H71.6279Z"
        fill="#A4161A"
      />
    </svg>
  );
}

// In-app brand mark (source of truth 2026-06-07): white Λ on a cherry plate,
// rounded square radius 8. Used everywhere a mark appears inside the app
// (Тип 2 header). The full «ΛOCG» wordmark (AocgLogo) is login/splash only.
function MarkPlate({ size = 40, radius = 8 }) {
  const glyph = Math.round(size * 0.52);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: C.cherry,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <svg
        width={glyph}
        height={glyph}
        viewBox="0 0 179.07 179.07"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M71.6279 0L0 179.07H35.814L89.5349 44.7674L143.256 179.07H179.07L107.442 0H71.6279Z"
          fill="#ffffff"
        />
      </svg>
    </div>
  );
}

// Тип 2 header — left-block app switcher. Switches PLATFORM APPLICATIONS
// (Документы / Финансы / Инструменты), never «модули». «Финансы» is the
// current product (Чеки live inside it); the others are placeholders.
function AppSwitcher({ onClose, onPick }) {
  const apps = [
    {
      id: "documents",
      label: "Документы",
      sub: "Прима · документооборот",
      soon: true,
    },
    { id: "finance", label: "Финансы", sub: "Чеки, ДДС, ОПУ", active: true },
    {
      id: "tools",
      label: "Инструменты",
      sub: "Сервисы и интеграции",
      soon: true,
    },
  ];
  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 40 }}
      />
      <div
        role="menu"
        style={{
          position: "absolute",
          top: "calc(100% + 2px)",
          left: 8,
          zIndex: 41,
          width: 256,
          background: C.white,
          border: `1px solid ${C.silver}`,
          borderRadius: 12,
          boxShadow: "0 8px 30px rgba(17,19,24,0.16)",
          padding: 6,
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            padding: "8px 10px 6px",
            fontFamily: FONT,
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: C.gray,
          }}
        >
          Приложения
        </div>
        {apps.map((a) => (
          <button
            key={a.id}
            disabled={a.soon}
            onClick={() => {
              if (a.active) {
                onPick && onPick(a.id);
              }
              onClose();
            }}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "9px 10px",
              border: "none",
              borderRadius: 8,
              cursor: a.soon ? "default" : "pointer",
              background: a.active ? "#FDF2F2" : "transparent",
              textAlign: "left",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontFamily: FONT,
                  fontSize: 14,
                  fontWeight: a.active ? 600 : 500,
                  color: a.soon ? C.grayL : "#111318",
                }}
              >
                {a.label}
                {a.soon && (
                  <span
                    style={{ fontWeight: 400, fontSize: 12, color: C.grayL }}
                  >
                    {" "}
                    · Скоро
                  </span>
                )}
              </div>
              <div
                style={{
                  fontFamily: FONT,
                  fontSize: 12,
                  color: C.gray,
                  marginTop: 1,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {a.sub}
              </div>
            </div>
            {a.active && <Check size={16} color={C.cherry} strokeWidth={2.5} />}
          </button>
        ))}
      </div>
    </>
  );
}

function AuthShell({ children }) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        background: C.white,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: "32px 24px",
        boxSizing: "border-box",
        fontFamily: FONT,
      }}
    >
      {children}
    </div>
  );
}

const A_INPUT = {
  width: "100%",
  padding: "13px 14px",
  border: `1px solid ${C.silver}`,
  borderRadius: 10,
  fontSize: 15,
  fontFamily: FONT,
  color: C.dark,
  background: C.white,
  boxSizing: "border-box",
  outline: "none",
};

function LoginScreen({ onAuthed, navigate }) {
  const [ident, setIdent] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!ident.trim() || !password || busy) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetchWithTimeout(
        API + "/api/auth/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone_or_email: ident.trim(), password }),
        },
        15000,
      );
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.access_token) {
        onAuthed(d);
        return;
      } // success flow unchanged
      if (res.status === 429)
        setErr("Аккаунт заблокирован на 15 минут. Попробуйте позже");
      else setErr("Неверный телефон/email или пароль");
    } catch {
      setErr("Не удалось войти. Проверьте интернет");
    } finally {
      setBusy(false);
    }
  }
  const oauthSoon = () => alert("OAuth скоро будет доступен");
  const forgotSoon = () => alert("Восстановление пароля скоро будет доступно");
  const fieldStyle = {
    width: "100%",
    height: 48,
    border: "1px solid #EEF0F4",
    borderRadius: 12,
    padding: "14px 16px",
    fontSize: 15,
    fontFamily: FONT,
    color: "#111318",
    background: "#fff",
    boxSizing: "border-box",
    outline: "none",
  };
  // Stylized colored circles (20px) with provider letter — no official SVGs in project.
  const OAUTH = [
    ["yandex", "Я", "Войти через Яндекс ID", "#FC3F1D", "#fff"],
    ["google", "G", "Войти через Google", "#fff", "#4285F4"],
    ["mailru", "@", "Войти через Mail.ru", "#005FF9", "#fff"],
  ];
  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "#F6F7F9",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        paddingBottom: "calc(24px + env(safe-area-inset-bottom))",
        boxSizing: "border-box",
        fontFamily: FONT,
      }}
    >
      <div style={{ width: "100%", maxWidth: 400 }}>
        {/* Header — logo 32px + «AI Офис», без слогана */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            marginBottom: 32,
          }}
        >
          <AocgLogo height={32} />
          <span
            style={{
              fontFamily: FONT,
              fontSize: 18,
              fontWeight: 600,
              color: "#111318",
            }}
          >
            AI Офис
          </span>
        </div>

        {/* Card */}
        <div
          style={{
            background: "#FFFFFF",
            borderRadius: 16,
            padding: 32,
            boxShadow: "0 1px 3px rgba(17,19,24,0.04)",
          }}
        >
          {/* OAuth — приоритетный путь */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              marginBottom: 24,
            }}
          >
            {OAUTH.map(([key, icon, label, bg, fg]) => (
              <button
                key={key}
                className="aocg-oauth-btn"
                onClick={oauthSoon}
                type="button"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  height: 48,
                  width: "100%",
                  background: "#fff",
                  border: "1px solid #EEF0F4",
                  borderRadius: 12,
                  padding: "0 16px",
                  cursor: "pointer",
                  transition: "background 120ms ease,border-color 120ms ease",
                }}
              >
                <span
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: bg,
                    color: fg,
                    border: bg === "#fff" ? "1px solid #EEF0F4" : "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: FONT,
                    fontSize: 12,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {icon}
                </span>
                <span
                  style={{
                    fontFamily: FONT,
                    fontSize: 15,
                    fontWeight: 500,
                    color: "#111318",
                  }}
                >
                  {label}
                </span>
              </button>
            ))}
          </div>

          {/* Divider */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 24,
            }}
          >
            <div style={{ flex: 1, height: 1, background: "#EEF0F4" }} />
            <span style={{ fontFamily: FONT, fontSize: 13, color: "#636B7D" }}>
              или
            </span>
            <div style={{ flex: 1, height: 1, background: "#EEF0F4" }} />
          </div>

          {/* Email / Password */}
          <input
            className="aocg-login-input"
            value={ident}
            onChange={(e) => setIdent(e.target.value)}
            placeholder="Телефон или Email"
            aria-label="Телефон или Email"
            autoCapitalize="none"
            autoCorrect="off"
            style={{ ...fieldStyle, marginBottom: 12 }}
          />
          <div style={{ position: "relative" }}>
            <input
              className="aocg-login-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type={showPw ? "text" : "password"}
              placeholder="Пароль"
              aria-label="Пароль"
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              style={{ ...fieldStyle, paddingRight: 44 }}
            />
            <button
              onClick={() => setShowPw((s) => !s)}
              type="button"
              aria-label={showPw ? "Скрыть пароль" : "Показать пароль"}
              style={{
                position: "absolute",
                right: 10,
                top: "50%",
                transform: "translateY(-50%)",
                border: "none",
                background: "none",
                cursor: "pointer",
                color: "#636B7D",
                display: "flex",
                padding: 4,
              }}
            >
              {showPw ? (
                <EyeOff size={18} aria-hidden="true" />
              ) : (
                <Eye size={18} aria-hidden="true" />
              )}
            </button>
          </div>

          {/* Забыли пароль? */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              marginTop: 12,
              marginBottom: 20,
            }}
          >
            <button
              onClick={forgotSoon}
              type="button"
              className="aocg-cherry-link"
              style={{
                background: "none",
                border: "none",
                padding: 0,
                fontFamily: FONT,
                fontSize: 14,
                fontWeight: 500,
                color: "#A4161A",
                cursor: "pointer",
              }}
            >
              Забыли пароль?
            </button>
          </div>

          {/* Ошибка */}
          {err && (
            <div
              style={{
                background: "#FEF2F2",
                color: "#B91C1C",
                padding: 12,
                borderRadius: 8,
                fontFamily: FONT,
                fontSize: 13,
                marginBottom: 16,
              }}
            >
              {err}
            </div>
          )}

          {/* Войти */}
          <button
            onClick={submit}
            disabled={busy}
            className="aocg-login-submit"
            style={{
              width: "100%",
              height: 48,
              background: "#A4161A",
              color: "#fff",
              border: "none",
              borderRadius: 12,
              fontFamily: FONT,
              fontSize: 15,
              fontWeight: 600,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.5 : 1,
              transition: "opacity 100ms ease,background 120ms ease",
            }}
          >
            {busy ? "Вход…" : "Войти"}
          </button>
        </div>

        {/* Регистрация */}
        <div
          style={{
            textAlign: "center",
            marginTop: 24,
            fontFamily: FONT,
            fontSize: 14,
          }}
        >
          <span style={{ color: "#636B7D" }}>Нет аккаунта? </span>
          <button
            onClick={() => navigate("/register")}
            type="button"
            className="aocg-cherry-link"
            style={{
              background: "none",
              border: "none",
              padding: 0,
              fontFamily: FONT,
              fontSize: 14,
              fontWeight: 500,
              color: "#A4161A",
              cursor: "pointer",
            }}
          >
            Зарегистрироваться
          </button>
        </div>
      </div>
    </div>
  );
}

function VerifyEmailScreen({ onAuthed, navigate }) {
  const token = new URLSearchParams(window.location.search).get("token");
  const [state, setState] = useState(token ? "loading" : "error"); // loading | error
  useEffect(() => {
    if (!token) return;
    fetchWithTimeout(
      API + "/api/auth/verify-email?token=" + encodeURIComponent(token),
      {},
      15000,
    )
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (r.ok && d.access_token) onAuthed(d);
        else setState("error");
      })
      .catch(() => setState("error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <AuthShell>
      <div style={{ textAlign: "center", maxWidth: 340 }}>
        <AocgLogo width={120} />
        <div
          style={{
            marginTop: 22,
            fontSize: 15,
            color: C.dark,
            fontFamily: FONT,
          }}
        >
          {state === "loading"
            ? "Подтверждаем email…"
            : "Ссылка недействительна или истекла"}
        </div>
        {state === "error" && (
          <button
            onClick={() => navigate("/login")}
            type="button"
            style={{
              marginTop: 16,
              background: "none",
              border: "none",
              color: C.cherry,
              fontSize: 14,
              cursor: "pointer",
              fontFamily: FONT,
            }}
          >
            ← Ко входу
          </button>
        )}
      </div>
    </AuthShell>
  );
}

function CheckEmailScreen({ email, navigate }) {
  return (
    <AuthShell>
      <div
        style={{
          maxWidth: 340,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
        }}
      >
        <Mail size={48} color={C.cherry} strokeWidth={1.5} />
        <h1
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: C.dark,
            fontFamily: FONT,
            margin: "16px 0 8px",
          }}
        >
          Проверьте почту
        </h1>
        <div
          style={{
            fontSize: 14,
            color: "#636B7D",
            fontFamily: FONT,
            lineHeight: 1.5,
          }}
        >
          Мы отправили письмо на <b style={{ color: C.dark }}>{email}</b>.
          Откройте ссылку в письме, чтобы подтвердить аккаунт.
        </div>
        <button
          onClick={() => {
            window.location.href = "mailto:";
          }}
          type="button"
          style={{
            marginTop: 22,
            padding: "12px 24px",
            background: C.cherry,
            color: "#fff",
            border: "none",
            borderRadius: 10,
            fontFamily: FONT,
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Открыть почту
        </button>
        <button
          onClick={() => navigate("/login")}
          type="button"
          style={{
            marginTop: 16,
            background: "none",
            border: "none",
            color: C.cherry,
            fontSize: 14,
            cursor: "pointer",
            fontFamily: FONT,
          }}
        >
          ← Ко входу
        </button>
      </div>
    </AuthShell>
  );
}

function RegisterScreen({ onAuthed, navigate }) {
  const [step, setStep] = useState(1); // 1: choose type, 2: form
  const [orgType, setOrgType] = useState(null); // 'person' | 'company'
  const [f, setF] = useState({
    inn: "",
    org_name: "",
    phone: "",
    email: "",
    password: "",
    password2: "",
    first_name: "",
    last_name: "",
  });
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  async function onInn(v) {
    set("inn", v);
    const digits = v.replace(/\D/g, "");
    if (digits.length === 10 || digits.length === 12) {
      try {
        const r = await fetchWithTimeout(
          API + "/api/egrul/" + digits,
          {},
          9000,
        );
        const d = await r.json().catch(() => null);
        if (d && d.name) set("org_name", d.name);
      } catch {
        /* manual entry */
      }
    }
  }

  async function submit() {
    setErr("");
    if (!f.email.trim() || !f.password) {
      setErr("Заполните email и пароль");
      return;
    }
    if (f.password.length < 8) {
      setErr("Пароль не менее 8 символов");
      return;
    }
    if (f.password !== f.password2) {
      setErr("Пароли не совпадают");
      return;
    }
    if (!f.first_name.trim()) {
      setErr("Укажите имя");
      return;
    }
    setBusy(true);
    try {
      const body = {
        phone: f.phone.trim() || null,
        email: f.email.trim(),
        password: f.password,
        first_name: f.first_name.trim(),
        last_name: f.last_name.trim(),
        org_type: orgType,
        org_name: orgType === "company" ? f.org_name.trim() : null,
        inn: orgType === "company" ? f.inn.replace(/\D/g, "") || null : null,
      };
      const res = await fetchWithTimeout(
        API + "/api/auth/register",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        15000,
      );
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        if (d.access_token) {
          onAuthed(d);
          return;
        } // auto-verified (no email provider)
        setSent(true);
        return; // verification email sent
      }
      setErr(
        typeof d.detail === "string"
          ? d.detail
          : "Не удалось зарегистрироваться",
      );
    } catch {
      setErr("Нет связи с сервером");
    } finally {
      setBusy(false);
    }
  }

  if (sent) return <CheckEmailScreen email={f.email} navigate={navigate} />;

  const typeBtn = (label, desc, t) => (
    <button
      onClick={() => {
        setOrgType(t);
        setStep(2);
        setErr("");
      }}
      type="button"
      style={{
        width: "100%",
        textAlign: "left",
        padding: "14px 16px",
        border: `1px solid ${orgType === t ? C.cherry : C.silver}`,
        borderRadius: 12,
        background: C.white,
        cursor: "pointer",
        marginBottom: 10,
      }}
    >
      <div
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: C.dark,
          fontFamily: FONT,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 12,
          color: "#636B7D",
          fontFamily: FONT,
          marginTop: 2,
        }}
      >
        {desc}
      </div>
    </button>
  );

  return (
    <AuthShell>
      <div
        style={{
          width: "100%",
          maxWidth: 380,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <AocgLogo width={120} />
        {step === 1 ? (
          <div style={{ width: "100%", marginTop: 22 }}>
            <div
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: C.dark,
                fontFamily: FONT,
                textAlign: "center",
                marginBottom: 18,
              }}
            >
              Как будете использовать AI Офис?
            </div>
            {typeBtn("Для себя", "ИП или физлицо", "person")}
            {typeBtn("Для компании", "ООО, АО — с ИНН", "company")}
            <button
              onClick={() => navigate("/login")}
              type="button"
              style={{
                marginTop: 8,
                width: "100%",
                background: "none",
                border: "none",
                color: C.cherry,
                fontFamily: FONT,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Уже есть аккаунт? Войти
            </button>
          </div>
        ) : (
          <div
            style={{
              width: "100%",
              marginTop: 18,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <button
              onClick={() => setStep(1)}
              type="button"
              style={{
                alignSelf: "flex-start",
                background: "none",
                border: "none",
                color: "#636B7D",
                fontFamily: FONT,
                fontSize: 13,
                cursor: "pointer",
                padding: 0,
                marginBottom: 2,
              }}
            >
              ← Назад
            </button>
            {orgType === "company" && (
              <>
                <input
                  value={f.inn}
                  onChange={(e) => onInn(e.target.value)}
                  inputMode="numeric"
                  placeholder="ИНН компании"
                  aria-label="ИНН компании"
                  style={A_INPUT}
                />
                <input
                  value={f.org_name}
                  onChange={(e) => set("org_name", e.target.value)}
                  placeholder="Название компании"
                  aria-label="Название компании"
                  style={A_INPUT}
                />
              </>
            )}
            <input
              value={f.first_name}
              onChange={(e) => set("first_name", e.target.value)}
              placeholder="Имя"
              aria-label="Имя"
              style={A_INPUT}
            />
            <input
              value={f.last_name}
              onChange={(e) => set("last_name", e.target.value)}
              placeholder="Фамилия"
              aria-label="Фамилия"
              style={A_INPUT}
            />
            <input
              value={f.phone}
              onChange={(e) => set("phone", e.target.value)}
              inputMode="tel"
              placeholder="Телефон"
              aria-label="Телефон"
              style={A_INPUT}
            />
            <input
              value={f.email}
              onChange={(e) => set("email", e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="Email"
              aria-label="Email"
              style={A_INPUT}
            />
            <div style={{ position: "relative" }}>
              <input
                value={f.password}
                onChange={(e) => set("password", e.target.value)}
                type={showPw ? "text" : "password"}
                placeholder="Пароль (от 8 символов)"
                aria-label="Пароль"
                style={{ ...A_INPUT, paddingRight: 44 }}
              />
              <button
                onClick={() => setShowPw((s) => !s)}
                type="button"
                aria-label={showPw ? "Скрыть пароль" : "Показать пароль"}
                style={{
                  position: "absolute",
                  right: 8,
                  top: "50%",
                  transform: "translateY(-50%)",
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  color: "#636B7D",
                  display: "flex",
                  padding: 6,
                }}
              >
                {showPw ? (
                  <EyeOff size={18} aria-hidden="true" />
                ) : (
                  <Eye size={18} aria-hidden="true" />
                )}
              </button>
            </div>
            <input
              value={f.password2}
              onChange={(e) => set("password2", e.target.value)}
              type={showPw ? "text" : "password"}
              placeholder="Повторите пароль"
              aria-label="Повторите пароль"
              style={A_INPUT}
            />
            {err && (
              <div style={{ color: C.cherry, fontSize: 13, fontFamily: FONT }}>
                {err}
              </div>
            )}
            <button
              onClick={submit}
              disabled={busy}
              style={{
                marginTop: 4,
                padding: "13px",
                background: C.cherry,
                color: "#fff",
                border: "none",
                borderRadius: 10,
                fontFamily: FONT,
                fontSize: 15,
                fontWeight: 600,
                cursor: busy ? "default" : "pointer",
                opacity: busy ? 0.7 : 1,
              }}
            >
              {busy ? "Создаём…" : "Зарегистрироваться"}
            </button>
          </div>
        )}
      </div>
    </AuthShell>
  );
}

function JoinScreen({ token, onAuthed, navigate }) {
  const [info, setInfo] = useState(null); // {is_valid, role, org_name}
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState({
    first_name: "",
    last_name: "",
    phone: "",
    email: "",
    password: "",
    password2: "",
  });
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    fetchWithTimeout(
      API + "/api/invite/validate/" + encodeURIComponent(token),
      {},
      12000,
    )
      .then(async (r) => {
        setInfo(await r.json().catch(() => null));
      })
      .catch(() => setInfo(null))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit() {
    setErr("");
    if (!f.email.trim() || !f.password) {
      setErr("Заполните email и пароль");
      return;
    }
    if (f.password.length < 8) {
      setErr("Пароль не менее 8 символов");
      return;
    }
    if (f.password !== f.password2) {
      setErr("Пароли не совпадают");
      return;
    }
    if (!f.first_name.trim()) {
      setErr("Укажите имя");
      return;
    }
    setBusy(true);
    try {
      const body = {
        token,
        phone: f.phone.trim() || null,
        email: f.email.trim(),
        password: f.password,
        first_name: f.first_name.trim(),
        last_name: f.last_name.trim(),
      };
      const res = await fetchWithTimeout(
        API + "/api/auth/register-by-invite",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        15000,
      );
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        if (d.access_token) {
          onAuthed(d);
          return;
        }
        setSent(true);
        return;
      }
      setErr(
        typeof d.detail === "string" ? d.detail : "Не удалось присоединиться",
      );
    } catch {
      setErr("Нет связи с сервером");
    } finally {
      setBusy(false);
    }
  }

  if (loading)
    return (
      <AuthShell>
        <div style={{ textAlign: "center" }}>
          <AocgLogo width={120} />
          <div
            style={{
              marginTop: 22,
              fontSize: 14,
              color: "#636B7D",
              fontFamily: FONT,
            }}
          >
            Проверяем приглашение…
          </div>
        </div>
      </AuthShell>
    );
  if (!info || !info.is_valid)
    return (
      <AuthShell>
        <div style={{ textAlign: "center", maxWidth: 340 }}>
          <AocgLogo width={120} />
          <div
            style={{
              marginTop: 22,
              fontSize: 15,
              color: C.dark,
              fontFamily: FONT,
            }}
          >
            Ссылка недействительна или истекла
          </div>
          <button
            onClick={() => navigate("/login")}
            type="button"
            style={{
              marginTop: 16,
              background: "none",
              border: "none",
              color: C.cherry,
              fontSize: 14,
              cursor: "pointer",
              fontFamily: FONT,
            }}
          >
            ← Ко входу
          </button>
        </div>
      </AuthShell>
    );
  if (sent) return <CheckEmailScreen email={f.email} navigate={navigate} />;

  return (
    <AuthShell>
      <div
        style={{
          width: "100%",
          maxWidth: 380,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <AocgLogo width={120} />
        <div
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: C.dark,
            fontFamily: FONT,
            marginTop: 18,
            textAlign: "center",
          }}
        >
          Присоединиться к «{info.org_name}»
        </div>
        <div
          style={{
            fontSize: 13,
            color: "#636B7D",
            fontFamily: FONT,
            marginBottom: 18,
          }}
        >
          Роль: {roleLabel(info.role)}
        </div>
        <div
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <input
            value={f.first_name}
            onChange={(e) => set("first_name", e.target.value)}
            placeholder="Имя"
            aria-label="Имя"
            style={A_INPUT}
          />
          <input
            value={f.last_name}
            onChange={(e) => set("last_name", e.target.value)}
            placeholder="Фамилия"
            aria-label="Фамилия"
            style={A_INPUT}
          />
          <input
            value={f.phone}
            onChange={(e) => set("phone", e.target.value)}
            inputMode="tel"
            placeholder="Телефон"
            aria-label="Телефон"
            style={A_INPUT}
          />
          <input
            value={f.email}
            onChange={(e) => set("email", e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="Email"
            aria-label="Email"
            style={A_INPUT}
          />
          <div style={{ position: "relative" }}>
            <input
              value={f.password}
              onChange={(e) => set("password", e.target.value)}
              type={showPw ? "text" : "password"}
              placeholder="Пароль (от 8 символов)"
              aria-label="Пароль"
              style={{ ...A_INPUT, paddingRight: 44 }}
            />
            <button
              onClick={() => setShowPw((s) => !s)}
              type="button"
              aria-label={showPw ? "Скрыть пароль" : "Показать пароль"}
              style={{
                position: "absolute",
                right: 8,
                top: "50%",
                transform: "translateY(-50%)",
                border: "none",
                background: "none",
                cursor: "pointer",
                color: "#636B7D",
                display: "flex",
                padding: 6,
              }}
            >
              {showPw ? (
                <EyeOff size={18} aria-hidden="true" />
              ) : (
                <Eye size={18} aria-hidden="true" />
              )}
            </button>
          </div>
          <input
            value={f.password2}
            onChange={(e) => set("password2", e.target.value)}
            type={showPw ? "text" : "password"}
            placeholder="Повторите пароль"
            aria-label="Повторите пароль"
            style={A_INPUT}
          />
          {err && (
            <div style={{ color: C.cherry, fontSize: 13, fontFamily: FONT }}>
              {err}
            </div>
          )}
          <button
            onClick={submit}
            disabled={busy}
            style={{
              marginTop: 4,
              padding: "13px",
              background: C.cherry,
              color: "#fff",
              border: "none",
              borderRadius: 10,
              fontFamily: FONT,
              fontSize: 15,
              fontWeight: 600,
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? "Присоединяем…" : "Присоединиться"}
          </button>
        </div>
      </div>
    </AuthShell>
  );
}

export default function App() {
  // Gate the entire UI behind the consent screen on first launch.
  // The flag is checked synchronously during the first render via lazy
  // initial state, so we don't flash the main interface for a frame.
  const [consentGiven, setConsentGiven] = useState(() => {
    try {
      return localStorage.getItem("consent_given") === "true";
    } catch {
      return false;
    }
  });
  const [page, setPage] = useState("svodka");
  const [appMenu, setAppMenu] = useState(false); // Тип 2 header — app switcher dropdown
  const [receipts, setReceipts] = useState([]);
  const [cards, setCards] = useState([]);
  const [users, setUsers] = useState([]);
  const [catalog, setCatalog] = useState(null); // D1: справочник категорий (группы+статьи)
  const [role, setRole] = useState(null); // D2: роль текущего юзера для гейта управления категориями
  const [activePeriod, setActivePeriod] = useState("month");

  // ─── Auth & lightweight routing ───
  const [authed, setAuthed] = useState(() => {
    try {
      return !!localStorage.getItem("access_token");
    } catch {
      return false;
    }
  });
  const [route, setRoute] = useState(() =>
    typeof window !== "undefined" ? window.location.pathname : "/",
  );
  const navigate = (path) => {
    try {
      window.history.pushState({}, "", path);
    } catch {
      /* ignore */
    }
    setRoute(path);
  };
  const onAuthed = (data) => {
    tokens.set(data);
    setAuthed(true);
    navigate("/");
  };
  useEffect(() => {
    const onPop = () => setRoute(window.location.pathname);
    const onLogout = () => setAuthed(false);
    window.addEventListener("popstate", onPop);
    window.addEventListener("auth:logout", onLogout);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("auth:logout", onLogout);
    };
  }, []);

  // D1/D2: загрузка каталога вынесена в callback — используется и при первичной
  // загрузке, и как onCatalogRefresh после CRUD в управлении категориями (Настройки).
  const loadCatalog = useCallback(() => {
    authFetch(`/api/categories/`)
      .then((r) => r.json())
      .then((data) => {
        setCatalogMaps(data);
        setCatalog(data && Array.isArray(data.groups) ? data : { groups: [] });
      })
      .catch(() => {});
  }, []);

  // Don't fetch receipts/cards until the user has consented — keeps the
  // consent screen network-quiet, and re-runs the moment they accept.
  useEffect(() => {
    if (!consentGiven || !authed) return;
    authFetch(`/api/receipts/`)
      .then((r) => r.json())
      .then((data) =>
        setReceipts(
          Array.isArray(data)
            ? data.map((r) => ({ ...r, amount: Number(r.amount) }))
            : [],
        ),
      )
      .catch(() => {});
    authFetch(`/api/cards/`)
      .then((r) => r.json())
      .then((data) => setCards(Array.isArray(data) ? data : []))
      .catch(() => {});
    authFetch(`/api/users/`)
      .then((r) => r.json())
      .then((data) => setUsers(Array.isArray(data) ? data : []))
      .catch(() => {});
    loadCatalog(); // D1: каталог категорий (группы+статьи)
    authFetch(`/api/users/me`) // D2: роль текущего юзера для гейта управления категориями
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && data.role) setRole(data.role);
      })
      .catch(() => {});
  }, [consentGiven, authed, loadCatalog]);

  async function addCard(name) {
    const res = await authFetch(`/api/cards/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      const c = await res.json();
      setCards((prev) => [...prev, c]);
    }
  }

  async function updateCard(id, name) {
    const res = await authFetch(`/api/cards/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      const c = await res.json();
      setCards((prev) => prev.map((x) => (x.id === id ? c : x)));
    }
  }

  async function deleteCard(id) {
    await authFetch(`/api/cards/${id}`, { method: "DELETE" });
    setCards((prev) => prev.filter((x) => x.id !== id));
  }

  async function setDefaultCard(id) {
    const res = await authFetch(`/api/cards/${id}/default`, {
      method: "PATCH",
    });
    if (res.ok)
      setCards((prev) => prev.map((x) => ({ ...x, is_default: x.id === id })));
  }

  async function addUser(payload) {
    const res = await authFetch(`/api/users/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const u = await res.json();
      setUsers((prev) => [...prev, u]);
      return u;
    }
    return null;
  }

  async function updateUser(id, patch) {
    const res = await authFetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const u = await res.json();
      setUsers((prev) => prev.map((x) => (x.id === id ? u : x)));
      return u;
    }
    return null;
  }

  async function deleteUser(id) {
    await authFetch(`/api/users/${id}`, { method: "DELETE" });
    setUsers((prev) => prev.filter((x) => x.id !== id));
  }

  function handleAdd(created) {
    const norm = { ...created, amount: Number(created.amount) };
    setReceipts((prev) =>
      prev.some((x) => x.id === norm.id)
        ? prev.map((x) => (x.id === norm.id ? norm : x))
        : [norm, ...prev],
    );
  }

  async function handleDelete(id) {
    const res = await authFetch(`/api/receipts/${id}`, { method: "DELETE" });
    if (res.ok) setReceipts((prev) => prev.filter((x) => x.id !== id));
    else alert("Не удалось удалить чек");
  }

  // Массовое удаление дублей из баннера (задача №9 фаза D). Возвращает тело ответа
  // {deleted, blocked_fns, blocked_in_report} (или null при сбое); на успехе
  // убирает удалённые id из списка (как handleDelete, но для массива).
  async function handleBulkDelete(ids, force = false) {
    try {
      const res = await authFetch(`/api/receipts/bulk-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, force }),
      });
      if (!res.ok) return null;
      const body = await res.json();
      if (body.deleted?.length)
        setReceipts((prev) => prev.filter((x) => !body.deleted.includes(x.id)));
      return body;
    } catch {
      return null;
    }
  }

  async function handleUpdate(id, patch) {
    try {
      const res = await authFetch(`/api/receipts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) return null;
      const updated = await res.json();
      const norm = { ...updated, amount: Number(updated.amount) };
      setReceipts((prev) => prev.map((r) => (r.id === id ? norm : r)));
      return norm;
    } catch {
      return null;
    }
  }

  // First-launch gate — show the consent screen until the user accepts. The
  // 152-FZ POST + localStorage flip happens inside onAccept; once flipped,
  // the main UI mounts and the receipts/cards effect re-runs.
  // ─── Auth & route gate ───
  const isRegister = route === "/register";
  const isVerify = route.startsWith("/verify-email");
  const isJoin = route.startsWith("/join/");
  if (route === "/login" || (!authed && !isRegister && !isVerify && !isJoin)) {
    return <LoginScreen onAuthed={onAuthed} navigate={navigate} />;
  }
  if (isRegister)
    return <RegisterScreen onAuthed={onAuthed} navigate={navigate} />;
  if (isVerify)
    return <VerifyEmailScreen onAuthed={onAuthed} navigate={navigate} />;
  if (isJoin)
    return (
      <JoinScreen
        token={route.split("/join/")[1] || ""}
        onAuthed={onAuthed}
        navigate={navigate}
      />
    );

  // Authed beyond this point.
  if (!consentGiven) {
    return <ConsentScreen onAccept={() => setConsentGiven(true)} />;
  }

  const NAV = [
    { id: "svodka", Icon: ChartColumn, label: "Сводка" },
    { id: "operacii", Icon: ReceiptText, label: "Чеки" },
    { id: "otchety", Icon: ClipboardList, label: "Отчёты" },
    { id: "nastroyki", Icon: Settings, label: "Настройки" },
  ];
  return (
    <div
      style={{
        maxWidth: 480,
        margin: "0 auto",
        height: "100dvh",
        display: "flex",
        flexDirection: "column",
        background: C.light,
        fontFamily: FONT,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          background: C.white,
          borderBottom: `1px solid ${C.silver}`,
          flexShrink: 0,
          paddingTop: "env(safe-area-inset-top)",
        }}
      >
        <div
          style={{
            padding: "10px 12px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            position: "relative",
          }}
        >
          {/* LEFT — plate Λ + chevron + org name; taps open the app switcher */}
          <button
            onClick={() => setAppMenu((o) => !o)}
            aria-label="Переключить приложение"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              border: "none",
              background: "none",
              cursor: "pointer",
              padding: "2px 4px",
              borderRadius: 8,
              minWidth: 0,
            }}
          >
            <MarkPlate size={40} />
            <ChevronDown
              size={16}
              color={C.gray}
              strokeWidth={2}
              style={{
                flexShrink: 0,
                transition: "transform 150ms ease",
                transform: appMenu ? "rotate(180deg)" : "none",
              }}
            />
            <span
              style={{
                fontSize: 16,
                fontFamily: FONT,
                fontWeight: 600,
                color: "#111318",
                whiteSpace: "nowrap",
              }}
            >
              АОЦГ
            </span>
          </button>
          {appMenu && <AppSwitcher onClose={() => setAppMenu(false)} />}
          {/* RIGHT — account (человечек) then bell (rightmost, cherry unread dot) */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexShrink: 0,
            }}
          >
            <button
              onClick={() => setPage("nastroyki")}
              aria-label="Аккаунт"
              style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                background: "#FFFFFF",
                border: "none",
                boxShadow: "0 1px 3px rgba(17,19,24,0.10)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                flexShrink: 0,
                transition: "opacity 120ms ease",
              }}
            >
              <User
                size={20}
                color="#111318"
                strokeWidth={1.75}
                aria-hidden="true"
              />
            </button>
            <button
              onClick={() => alert("Уведомления — скоро")}
              aria-label="Уведомления"
              style={{
                position: "relative",
                width: 40,
                height: 40,
                borderRadius: "50%",
                background: "#FFFFFF",
                border: "none",
                boxShadow: "0 1px 3px rgba(17,19,24,0.10)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                flexShrink: 0,
                transition: "opacity 120ms ease",
              }}
            >
              <Bell
                size={20}
                color="#111318"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <span
                style={{
                  position: "absolute",
                  top: 8,
                  right: 9,
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: C.cherry,
                  border: "1.5px solid #fff",
                }}
              />
            </button>
          </div>
        </div>
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        {page === "svodka" && (
          <SvodkaPage
            receipts={receipts}
            activePeriod={activePeriod}
            setActivePeriod={setActivePeriod}
            users={users}
            cards={cards}
            catalog={catalog}
          />
        )}
        {page === "operacii" && (
          <OperaciiPage
            receipts={receipts}
            cards={cards}
            catalog={catalog}
            handleAdd={handleAdd}
            handleDelete={handleDelete}
            handleUpdate={handleUpdate}
            handleBulkDelete={handleBulkDelete}
            activePeriod={activePeriod}
            setActivePeriod={setActivePeriod}
          />
        )}
        {page === "otchety" && <OtchetyPage receipts={receipts} />}
        {page === "nastroyki" && (
          <NastroykiPage
            cards={cards}
            onAddCard={addCard}
            onUpdateCard={updateCard}
            onDeleteCard={deleteCard}
            onSetDefaultCard={setDefaultCard}
            users={users}
            onAddUser={addUser}
            onUpdateUser={updateUser}
            onDeleteUser={deleteUser}
            role={role}
            catalog={catalog}
            onCatalogRefresh={loadCatalog}
          />
        )}
      </div>
      <div
        style={{
          background: C.white,
          borderTop: `1px solid ${C.silver}`,
          display: "flex",
          flexShrink: 0,
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {NAV.map((n) => {
          const Icon = n.Icon;
          const active = page === n.id;
          const color = active ? C.cherry : "#636B7D";
          return (
            <button
              key={n.id}
              onClick={() => setPage(n.id)}
              style={{
                flex: 1,
                padding: "8px 0 7px",
                border: "none",
                background: "transparent",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 3,
                cursor: "pointer",
                transition: "opacity 100ms ease",
              }}
            >
              <Icon size={22} color={color} strokeWidth={1.25} />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: active ? 600 : 500,
                  fontFamily: FONT,
                  color,
                }}
              >
                {n.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
