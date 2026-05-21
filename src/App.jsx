/* global __BUILD_TIME__ */
import { useState, useEffect, useRef, useCallback } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { Html5Qrcode, Html5QrcodeScannerState } from "html5-qrcode";
import jsQR from "jsqr";
import { Camera, ImageUp, PenLine, LayoutDashboard, Receipt, FileText, Settings, ReceiptText, Eye, EyeOff, Mail } from "lucide-react";

const API = import.meta.env.VITE_API_URL || "https://aocg-ai-office-production.up.railway.app";

// fetch with an abort-based ceiling. The receipt scanner awaits several
// backend calls (FNS check, payment suggestion, OCR) while showing a blocking
// spinner; any of them stalling would freeze the modal forever, so every one
// of them goes through here. On timeout the request is aborted and the throw
// propagates to the caller's catch (which treats it as a partial result).
function fetchWithTimeout(url, opts = {}, ms = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, {...opts, signal: ctrl.signal}).finally(() => clearTimeout(timer));
}

// ─── AUTH: token storage + authed fetch (refresh on 401) ───
const tokens = {
  get access()  { try { return localStorage.getItem("access_token"); }  catch { return null; } },
  get refresh() { try { return localStorage.getItem("refresh_token"); } catch { return null; } },
  set({access_token, refresh_token}) {
    try {
      if (access_token)  localStorage.setItem("access_token", access_token);
      if (refresh_token) localStorage.setItem("refresh_token", refresh_token);
    } catch { /* storage unavailable */ }
  },
  clear() {
    try { localStorage.removeItem("access_token"); localStorage.removeItem("refresh_token"); } catch { /* ignore */ }
  },
};

async function tryRefresh() {
  const rt = tokens.refresh;
  if (!rt) return false;
  try {
    const r = await fetch(API + "/api/auth/refresh", {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({refresh_token: rt}),
    });
    if (!r.ok) return false;
    const d = await r.json().catch(() => null);
    if (d && d.access_token) { tokens.set({access_token: d.access_token}); return true; }
  } catch { /* network */ }
  return false;
}

// Authed API call. Prepends the API base for "/..." paths, attaches the bearer
// token, and on 401 tries one refresh+retry; if that fails the session is
// cleared and an "auth:logout" event tells the app to drop to the login screen.
async function authFetch(path, opts = {}, ms = 15000, _retry = true) {
  const url = path.startsWith("http") ? path : `${API}${path}`;
  const headers = {...(opts.headers || {})};
  const tok = tokens.access;
  if (tok) headers["Authorization"] = `Bearer ${tok}`;
  const res = await fetchWithTimeout(url, {...opts, headers}, ms);
  if (res.status === 401 && _retry) {
    if (await tryRefresh()) return authFetch(path, opts, ms, false);
    tokens.clear();
    try { window.dispatchEvent(new Event("auth:logout")); } catch { /* ignore */ }
  }
  return res;
}

// Sign out: revoke the refresh token server-side, clear local tokens, drop to login.
async function logout() {
  const rt = tokens.refresh;
  try {
    await fetch(API + "/api/auth/logout", {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({refresh_token: rt}),
    });
  } catch { /* offline — clear locally anyway */ }
  tokens.clear();
  try { window.dispatchEvent(new Event("auth:logout")); } catch { /* ignore */ }
}

const C = {
  cherry:    "#A4161A",
  cherryD:   "#7a1014",
  cherryL:   "#F2E0E0",
  cherryM:   "#D4888A",
  dark:      "#161A1D",
  mid:       "#404040",
  gray:      "#6B7280",
  grayL:     "#9CA3AF",
  silver:    "#E8E4E0",
  lightGray: "#F0EDEA",
  light:     "#f5f3f0",
  white:     "#ffffff",
};

const FONT = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const CATEGORIES = ["Питание", "Транспорт", "Топливо", "Продукты", "Гостиница", "Канцелярия", "Прочее"];

const ROLES = [
  { id:"admin",      label:"Администратор", desc:"Заводит кабинет компании, регистрирует сотрудников, управляет лицензией." },
  { id:"employee",   label:"Сотрудник",     desc:"Добавляет первичные документы, создаёт отчёты и отправляет на проверку." },
  { id:"manager",    label:"Руководитель",  desc:"Проверяет отчёты: возвращает, одобряет или отклоняет. Смотрит статистику." },
  { id:"accountant", label:"Бухгалтер",     desc:"Регистрирует сотрудников, проверяет и выгружает отчёты в 1С." },
];

const fmt = n => Number(n).toLocaleString("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:2})+" ₽";
const fmtDate = s => new Date(s).toLocaleDateString("ru-RU",{day:"2-digit",month:"2-digit",year:"numeric"});
const monthLabel = s => new Date(s).toLocaleDateString("ru-RU",{month:"long",year:"numeric"}).replace(/^./,c=>c.toUpperCase());

const CATEGORY_COLORS = {
  "Топливо":    {bg:"#FDF2F2", fg:"#A4161A"},
  "Продукты":   {bg:"#F0FDF4", fg:"#15803D"},
  "Транспорт":  {bg:"#EFF6FF", fg:"#1D4ED8"},
  "Питание":    {bg:"#FFFBEB", fg:"#B45309"},
  "Гостиница":  {bg:"#F5F3FF", fg:"#6D28D9"},
  "Канцелярия": {bg:"#EEF0F4", fg:"#636B7D"},
  "Прочее":     {bg:"#EEF0F4", fg:"#636B7D"},
  "Не указано": {bg:"#EEF0F4", fg:"#636B7D"},
};
const catColor = c => CATEGORY_COLORS[c] || CATEGORY_COLORS["Не указано"];

// Prefix forms we strip when picking the avatar initial. The `И\s*\.?\s*П\s*\.?`
// alternative handles separated variants ("И П Иванов", "И. П. Иванов", "И.П.
// Иванов") in addition to the joined "ИП Иванов".
const ORG_PREFIX_RE = /^\s*(ООО|ОАО|АО|ИП|ЗАО|ПАО|ПК|И\s*\.?\s*П\s*\.?|ИНДИВИДУАЛЬНЫЙ\s+ПРЕДПРИНИМАТЕЛЬ)\s+/i;
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
    if (re.test(s)) { s = s.replace(re, abbr); break; }
  }
  return s.replace(/\s+/g, " ").trim();
}

function parseQRString(qr) {
  const p={};
  qr.split("&").forEach(part=>{const [k,...v]=part.split("=");p[k]=v.join("=");});
  const t=p.t||"";
  const date=t.length>=8?`${t.slice(0,4)}-${t.slice(4,6)}-${t.slice(6,8)}`:"";
  return {date,amount:p.s?String(parseFloat(p.s)):"",fn:p.fn||"",fd:p.i||"",fpd:p.fp||"",type:p.n||""};
}

const toLocalISO = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const todayISO = () => toLocalISO(new Date());
const daysAgoISO = d => { const x=new Date(); x.setDate(x.getDate()-d); return toLocalISO(x); };
const monthStartISO = () => { const x=new Date(); x.setDate(1); return toLocalISO(x); };
const quarterStartISO = () => { const d=new Date(); return toLocalISO(new Date(d.getFullYear(), Math.floor(d.getMonth()/3)*3, 1)); };

// ─── GLOBAL PERIOD ────────────────────────────────────────
const PERIOD_OPTIONS = [
  {key:"week",    label:"Неделя"},
  {key:"month",   label:"Месяц"},
  {key:"quarter", label:"Квартал"},
  {key:"year",    label:"Год"},
  {key:"all",     label:"Все"},
];
const periodLabel = k => (PERIOD_OPTIONS.find(o=>o.key===k)||PERIOD_OPTIONS[1]).label;
const periodKey   = l => (PERIOD_OPTIONS.find(o=>o.label===l)||PERIOD_OPTIONS[1]).key;
function inPeriod(date, period) {
  if (!date) return false;
  if (period==="all")     return true;
  if (period==="week")    return date>=daysAgoISO(7);
  if (period==="month")   return date.slice(0,7)===todayISO().slice(0,7);
  if (period==="quarter") return date>=quarterStartISO();
  if (period==="year")    return date.slice(0,4)===todayISO().slice(0,4);
  return true;
}
const fmtDateTime = ts => {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  return d.toLocaleString("ru-RU",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});
};

function groupByMonth(items) {
  const g={};
  items.forEach(r=>{const k=r.date.slice(0,7);if(!g[k])g[k]={label:monthLabel(r.date),items:[]};g[k].items.push(r);});
  return Object.entries(g).sort((a,b)=>b[0].localeCompare(a[0]));
}

// ─── ATOMS ────────────────────────────────────────────────

function SectionHead({num,title}) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:10,margin:"16px 0 8px"}}>
      {num&&<div style={{width:20,height:20,background:C.lightGray,color:C.gray,fontSize:9,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:FONT,flexShrink:0}}>{num}</div>}
      <span style={{fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",color:C.mid,fontFamily:FONT}}>{title}</span>
      <div style={{flex:1,height:"0.5px",background:C.silver}}/>
    </div>
  );
}

function Btn({children,onClick,disabled,outline,full,small}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background:disabled?C.lightGray:outline?"transparent":C.cherry,
      color:disabled?C.grayL:outline?C.cherry:C.white,
      border:`1.5px solid ${disabled?C.silver:C.cherry}`,
      padding:small?"6px 12px":"9px 18px",
      fontFamily:FONT,fontSize:10,letterSpacing:"0.1em",textTransform:"uppercase",
      cursor:disabled?"default":"pointer",transition:"all 0.15s",width:full?"100%":"auto",borderRadius:6
    }}>{children}</button>
  );
}

function RuleInput({label,value,onChange,type="text",placeholder}) {
  const [f,setF]=useState(false);
  return (
    <div style={{marginBottom:14}}>
      <div style={{fontSize:9,letterSpacing:"0.18em",textTransform:"uppercase",color:C.gray,marginBottom:4,fontFamily:FONT}}>{label}</div>
      <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
        onFocus={()=>setF(true)} onBlur={()=>setF(false)}
        style={{width:"100%",border:"none",borderBottom:`1.5px solid ${f?C.cherry:C.silver}`,outline:"none",
          padding:"7px 0",fontSize:13,fontFamily:FONT,color:C.dark,background:"transparent",boxSizing:"border-box",transition:"border-color 0.2s"}}/>
    </div>
  );
}

function Toggle({value,onChange}) {
  return (
    <div onClick={()=>onChange(!value)} style={{width:34,height:18,background:value?C.cherry:C.silver,position:"relative",cursor:"pointer",transition:"background 0.2s",flexShrink:0,borderRadius:6}}>
      <div style={{position:"absolute",top:2,left:value?16:2,width:12,height:12,background:C.white,boxShadow:"0 1px 3px rgba(0,0,0,0.15)",transition:"left 0.2s",borderRadius:4}}/>
    </div>
  );
}

function TabBar({tabs,active,onSelect}) {
  return (
    <div style={{display:"flex",borderBottom:`1px solid ${C.silver}`,background:C.white,overflowX:"auto"}}>
      {tabs.map(t=>(
        <button key={t} onClick={()=>onSelect(t)} style={{
          padding:"10px 14px",border:"none",background:"transparent",
          color:active===t?C.cherry:C.gray,fontFamily:FONT,fontSize:10,
          letterSpacing:"0.08em",textTransform:"uppercase",cursor:"pointer",
          whiteSpace:"nowrap",flexShrink:0,
          borderBottom:active===t?`2px solid ${C.cherry}`:"2px solid transparent",
          transition:"all 0.15s"
        }}>{t}</button>
      ))}
    </div>
  );
}

function Block({children,style:s}) {
  return <div style={{background:C.lightGray,borderLeft:`3px solid ${C.cherryM}`,padding:"10px 14px",marginBottom:10,...s}}>{children}</div>;
}

function Modal({title,onClose,children,footer}) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(22,26,29,0.45)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:100}}>
      <div style={{background:C.white,width:"100%",maxWidth:480,borderTop:`3px solid ${C.cherry}`,maxHeight:"82vh",display:"flex",flexDirection:"column",borderRadius:"12px 12px 0 0",overflow:"hidden"}}>
        <div style={{background:C.lightGray,borderBottom:`1px solid ${C.silver}`,padding:"11px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:3,height:14,background:C.cherry}}/>
            <span style={{fontSize:11,letterSpacing:"0.1em",textTransform:"uppercase",color:C.dark,fontFamily:FONT}}>{title}</span>
          </div>
          <button onClick={onClose} style={{border:"none",background:"none",color:C.gray,cursor:"pointer",fontSize:16}}>✕</button>
        </div>
        <div style={{overflow:"auto",flex:1,padding:"4px 16px 8px"}}>{children}</div>
        {footer&&<div style={{padding:"10px 16px calc(10px + env(safe-area-inset-bottom))",borderTop:`1px solid ${C.silver}`,background:C.lightGray,flexShrink:0}}>{footer}</div>}
      </div>
    </div>
  );
}

function SegmentedControl({segments,active,onChange}) {
  return (
    <div style={{display:"flex",background:"#EEF0F4",borderRadius:10,padding:2,gap:2}}>
      {segments.map(s=>{
        const on=s===active;
        return (
          <div key={s} onClick={()=>onChange(s)}
            style={{
              flex:1,textAlign:"center",padding:"6px 2px",borderRadius:8,cursor:"pointer",userSelect:"none",
              background:on?C.white:"transparent",
              color:on?"#A4161A":"#636B7D",
              boxShadow:on?"0 1px 3px rgba(0,0,0,0.12)":"none",
              fontSize:11,fontFamily:FONT,fontWeight:on?600:500,
              transition:"background 180ms ease, color 180ms ease, box-shadow 180ms ease"
            }}>{s}</div>
        );
      })}
    </div>
  );
}

function SectionCard({title,num,children}) {
  return (
    <div style={{background:C.white,border:`1px solid ${C.silver}`,marginBottom:8,borderRadius:8,overflow:"hidden"}}>
      <div style={{height:32,background:"#F6F7F9",borderBottom:`1px solid ${C.silver}`,display:"flex",alignItems:"center",gap:8,padding:"0 14px"}}>
        {num&&<span style={{fontSize:9,fontFamily:"'Courier New', Courier, monospace",color:"#9CA3AF"}}>{num}</span>}
        <span style={{fontSize:11,fontWeight:600,letterSpacing:"0.12em",color:"#636B7D",fontFamily:FONT,textTransform:"uppercase"}}>{title}</span>
      </div>
      <div style={{padding:"4px 14px 8px"}}>{children}</div>
    </div>
  );
}

// L-shaped corner markers for the cutout. Four absolutely-positioned divs,
// each drawing the two relevant borders. Color animates between white (idle)
// and #15803D (just captured) via a 300ms transition on border-color.
function CutoutCorners({size, color, len=20, thick=3}) {
  const off = `calc(50% - ${size/2}px)`;
  const transition = "border-color 300ms ease";
  const tl = {position:"absolute",width:len,height:len,top:off,left:off,
              borderTop:`${thick}px solid ${color}`,borderLeft:`${thick}px solid ${color}`,
              transition,pointerEvents:"none"};
  const tr = {position:"absolute",width:len,height:len,top:off,right:off,
              borderTop:`${thick}px solid ${color}`,borderRight:`${thick}px solid ${color}`,
              transition,pointerEvents:"none"};
  const bl = {position:"absolute",width:len,height:len,bottom:off,left:off,
              borderBottom:`${thick}px solid ${color}`,borderLeft:`${thick}px solid ${color}`,
              transition,pointerEvents:"none"};
  const br = {position:"absolute",width:len,height:len,bottom:off,right:off,
              borderBottom:`${thick}px solid ${color}`,borderRight:`${thick}px solid ${color}`,
              transition,pointerEvents:"none"};
  return <><div style={tl}/><div style={tr}/><div style={bl}/><div style={br}/></>;
}

// Decode a QR from a file via jsQR, with a contrast-boost retry. Returns the
// decoded text or null. We use this instead of html5-qrcode's scanFile() —
// jsQR has noticeably better detection on low-contrast thermal receipts.
async function decodeQrFromFile(file, {maxDim=1600}={}) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("image load failed"));
      i.src = url;
    });
    const tryDecode = (enhance) => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d", {willReadFrequently: true});
      if (enhance) ctx.filter = "contrast(1.5) brightness(1.1)";
      ctx.drawImage(img, 0, 0, w, h);
      let data;
      try { data = ctx.getImageData(0, 0, w, h); }
      catch { return null; }
      const result = jsQR(data.data, data.width, data.height, {inversionAttempts: "attemptBoth"});
      return result?.data || null;
    };
    return tryDecode(false) || tryDecode(true);
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
function ScanReceiptModal({onClose, onCapture, onPrefetch, onOcrFile, onManual}) {
  const [phase, setPhase] = useState("scanning"); // scanning | captured | loading | fnsError | cameraError | preview
  const [loadingMsg, setLoadingMsg] = useState("Загружаем данные из ФНС…");
  const [notice, setNotice] = useState(""); // subtle gray bottom notification (replaces red banner)
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [qrText, setQrText] = useState("");
  const [qrParsed, setQrParsed] = useState(null);
  const [flashGreen, setFlashGreen] = useState(false); // 0.5s green pulse on capture
  const [sheetOpen, setSheetOpen] = useState(false);   // photo-source bottom sheet
  const [previewFile, setPreviewFile] = useState(null);// chosen photo/file awaiting confirmation
  const [previewUrl, setPreviewUrl] = useState(null);  // object URL for the image preview (null for PDFs)
  const [previewBusy, setPreviewBusy] = useState(false); // OCR in flight on the preview screen
  const [previewNotice, setPreviewNotice] = useState(""); // OCR-failure notice on the preview screen
  const scannerRef = useRef(null);
  const cameraOn = useRef(false);
  const ocrFileRef = useRef(null);
  const cameraInputRef = useRef(null);   // <input capture="environment"> — take a photo
  const galleryInputRef = useRef(null);  // <input> — pick from gallery
  const filesInputRef = useRef(null);    // <input accept includes pdf> — pick from Files/iCloud
  const previewUrlRef = useRef(null);    // tracks the live object URL so we can revoke it
  const mountedRef = useRef(true);
  const autoTimerRef = useRef(null);   // the 1s "captured → auto-load" timer
  const cancelledRef = useRef(false);  // user tapped "Отмена"; discard any in-flight result

  // Latest callbacks behind a ref so the auto-load timer and the camera
  // effect (keyed on stable values) never restart just because the parent
  // re-rendered with fresh prop identities. The parent recreates onPrefetch /
  // onCapture every render; if `capture` depended on them directly it would
  // churn `startCamera` → tear down and restart html5-qrcode mid-scan, which
  // throws "Cannot clear while scan is ongoing" and white-screens the app.
  const cbRef = useRef({onCapture, onClose, onPrefetch});
  useEffect(() => { cbRef.current = {onCapture, onClose, onPrefetch}; });

  const CUTOUT = 270; // visual cutout size in px; matches design spec
  const cornerColor = (phase === "captured" || flashGreen) ? "#15803D" : "#FFFFFF";

  useEffect(() => () => {
    mountedRef.current = false;
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const capture = useCallback((text) => {
    try { if (navigator.vibrate) navigator.vibrate(100); } catch { /* ignored */ }
    setFlashGreen(true);
    setQrText(text);
    setQrParsed(parseQRString(text));
    setPhase("captured");
    const pf = cbRef.current.onPrefetch;
    if (pf) { try { pf(text); } catch { /* ignored */ } }
    setTimeout(() => { if (mountedRef.current) setFlashGreen(false); }, 500);
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
        cameraOn.current = false;
        try { s.pause(true); } catch { /* not in scanning state */ }
        capture(text);
      },
      () => { /* per-frame parse failures are noise */ }
    ).then(() => {
      cameraOn.current = true;
      try {
        const caps = s.getRunningTrackCapabilities?.() || {};
        if (caps.torch) setTorchSupported(true);
        if (Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) {
          s.applyVideoConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});
        }
      } catch { /* capabilities unavailable */ }
    }).catch(() => {
      setNotice("Нет доступа к камере");
      setPhase("cameraError");
    });
  }, [capture]);

  useEffect(() => {
    startCamera();
    return () => {
      const s = scannerRef.current;
      if (!s) return;
      cameraOn.current = false;
      s.stop().catch(() => {});
    };
  }, [startCamera]);

  async function toggleTorch() {
    if (!scannerRef.current || !cameraOn.current) return;
    const next = !torchOn;
    try {
      await scannerRef.current.applyVideoConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
    }
  }

  async function rescan() {
    setNotice("");
    setQrText(""); setQrParsed(null); setFlashGreen(false);
    setPhase("scanning");
    const s = scannerRef.current;
    try {
      if (s && s.getState && s.getState() === Html5QrcodeScannerState.PAUSED) {
        s.resume();
        cameraOn.current = true;
        return;
      }
    } catch { /* ignored */ }
    if (s) { try { await s.stop().catch(() => {}); } catch { /* ignored */ } }
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
    try { result = await cbRef.current.onCapture(text); }
    catch { result = "partial"; }
    if (!mountedRef.current || cancelledRef.current) return; // cancelled mid-flight → keep scanning
    if (result === "ok") cbRef.current.onClose();
    else setPhase("fnsError");
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
    return () => { if (autoTimerRef.current) clearTimeout(autoTimerRef.current); };
  }, [phase, qrText, runFnsLoad]);

  // "Отмена" — works during the 1s preview window and during loading. Cancels
  // the pending auto-load, discards any in-flight result, resumes scanning.
  function cancel(e) {
    if (e && e.preventDefault) e.preventDefault();
    cancelledRef.current = true;
    if (autoTimerRef.current) { clearTimeout(autoTimerRef.current); autoTimerRef.current = null; }
    rescan();
  }

  async function handleOcrPick(file) {
    if (!file || !onOcrFile) return;
    cancelledRef.current = false;
    setLoadingMsg("Распознаём чек…");
    setPhase("loading");
    let result;
    try { result = await onOcrFile(file); }
    catch { result = "partial"; }
    if (!mountedRef.current || cancelledRef.current) return;
    if (result === "ok") onClose();
    else setPhase("fnsError");
  }

  // ─── Photo upload: source sheet → preview → use ────────────────
  function revokePreviewUrl() {
    if (previewUrlRef.current) { URL.revokeObjectURL(previewUrlRef.current); previewUrlRef.current = null; }
  }
  function clearPreview() {
    revokePreviewUrl();
    setPreviewUrl(null); setPreviewFile(null); setPreviewNotice(""); setPreviewBusy(false);
  }

  function openSheet(e) {
    if (e && e.preventDefault) e.preventDefault();
    setNotice("");
    cameraOn.current = false; // gate background scanning while the sheet / preview is up
    setSheetOpen(true);
  }
  function closeSheet(e) {
    if (e && e.preventDefault) e.preventDefault();
    setSheetOpen(false);
    if (phase === "scanning") cameraOn.current = true;
  }

  // A source input fired. Stash the file and show the preview screen; QR
  // decode / OCR are deferred to "Использовать". Images get an object URL;
  // PDFs fall back to a filename placeholder (no inline render).
  function pickFile(file) {
    if (!file) return;
    cameraOn.current = false; // gate the live scanner while the preview is up
    revokePreviewUrl();
    const url = file.type && file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    previewUrlRef.current = url;
    setPreviewUrl(url);
    setPreviewFile(file);
    setPreviewNotice("");
    setPreviewBusy(false);
    setSheetOpen(false);
    setPhase("preview");
  }

  function previewBack(e) {   // ‹ Назад — abandon the photo, back to the live camera
    if (e && e.preventDefault) e.preventDefault();
    clearPreview();
    setPhase("scanning");
    cameraOn.current = true;
  }
  function previewRetake(e) { // Переснять — reopen the source sheet
    if (e && e.preventDefault) e.preventDefault();
    clearPreview();
    setPhase("scanning");
    cameraOn.current = false;
    setSheetOpen(true);
  }

  // "Использовать": QR first (jsQR/Canvas) → standard two-phase FNS flow;
  // otherwise OCR the file. OCR failure stays on the preview with a manual
  // fallback.
  async function usePhoto(e) {
    if (e && e.preventDefault) e.preventDefault();
    const file = previewFile;
    if (!file) return;
    setPreviewNotice("");
    let text = null;
    try { text = await decodeQrFromFile(file); }
    catch { /* not an image, or no QR — fall through to OCR */ }
    if (!mountedRef.current) return;
    if (text) {
      clearPreview();
      capture(text);   // → captured → 1s → FNS auto-load
      return;
    }
    if (!onOcrFile) { setPreviewNotice("Не удалось распознать. Заполните вручную"); return; }
    setPreviewBusy(true);
    let result;
    try { result = await onOcrFile(file); }
    catch { result = "partial"; }
    if (!mountedRef.current) return;
    setPreviewBusy(false);
    if (result === "ok") { clearPreview(); onClose(); }
    else setPreviewNotice("Не удалось распознать. Заполните вручную");
  }

  // ─── UI ────────────────────────────────────────────────────────
  const dimmed = phase === "loading" || phase === "fnsError" || phase === "cameraError";

  return (
    <div style={{position:"fixed",inset:0,zIndex:200,background:"#000",overflow:"hidden",width:"100vw",height:"100dvh"}}>
      {/* Force html5-qrcode's nested <video> to cover the whole viewport. */}
      <style>{`#qr-reader,#qr-reader>div,#qr-reader video{width:100%!important;height:100%!important;object-fit:cover!important;border:none!important}`}</style>

      {/* Camera fills the screen */}
      <div id="qr-reader" style={{position:"absolute",inset:0,width:"100%",height:"100%"}}/>

      {/* Dark overlay with cutout — 4 picture-frame rectangles around a
          transparent 260×260 square in the center. Hidden during loading /
          error phases (where we use a uniform full-screen dim instead). */}
      {!dimmed && phase !== "preview" && <>
        <div style={{position:"absolute",top:0,left:0,right:0,height:`calc(50% - ${CUTOUT/2}px)`,background:"rgba(0,0,0,0.55)"}}/>
        <div style={{position:"absolute",bottom:0,left:0,right:0,height:`calc(50% - ${CUTOUT/2}px)`,background:"rgba(0,0,0,0.55)"}}/>
        <div style={{position:"absolute",top:`calc(50% - ${CUTOUT/2}px)`,bottom:`calc(50% - ${CUTOUT/2}px)`,left:0,width:`calc(50% - ${CUTOUT/2}px)`,background:"rgba(0,0,0,0.55)"}}/>
        <div style={{position:"absolute",top:`calc(50% - ${CUTOUT/2}px)`,bottom:`calc(50% - ${CUTOUT/2}px)`,right:0,width:`calc(50% - ${CUTOUT/2}px)`,background:"rgba(0,0,0,0.55)"}}/>
        <CutoutCorners size={CUTOUT} color={cornerColor}/>
      </>}

      {/* Full-screen dim for loading / FNS error / camera error */}
      {dimmed && <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.7)"}}/>}

      {/* Top bar — back + flashlight (both white, circular, blurred backdrop).
          Hidden in the preview screen, which carries its own back button. */}
      {phase !== "preview" && (
      <div style={{position:"absolute",top:0,left:0,right:0,padding:"calc(env(safe-area-inset-top) + 12px) 16px 12px",display:"flex",justifyContent:"space-between",alignItems:"center",zIndex:5,pointerEvents:"none"}}>
        <button type="button" onClick={(e) => { e.preventDefault(); onClose(); }} aria-label="Назад"
          style={{pointerEvents:"auto",width:44,height:44,borderRadius:"50%",border:"none",background:"rgba(0,0,0,0.4)",color:"#fff",fontSize:26,lineHeight:1,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(8px)"}}>‹</button>
        {torchSupported && (phase === "scanning" || phase === "captured") && (
          <button type="button" onClick={(e) => { e.preventDefault(); toggleTorch(); }} aria-label="Фонарик" aria-pressed={torchOn}
            style={{pointerEvents:"auto",width:44,height:44,borderRadius:"50%",border:"none",
              background: torchOn ? "rgba(255,221,87,0.95)" : "rgba(0,0,0,0.4)",
              color: torchOn ? "#161A1D" : "#fff",fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",
              backdropFilter:"blur(8px)"}}>
            🔦
          </button>
        )}
      </div>
      )}

      {/* Preview / loading / FNS-error all live in the bottom pill now. */}

      {/* Camera error */}
      {phase === "cameraError" && (
        <div style={{position:"absolute",top:"42%",left:"50%",transform:"translate(-50%,-50%)",padding:"12px 18px",background:"rgba(255,255,255,0.12)",borderRadius:10,maxWidth:340,textAlign:"center"}}>
          <span style={{fontSize:13,color:"#fff",fontFamily:FONT}}>{notice || "Нет доступа к камере"}</span>
        </div>
      )}

      {/* Soft gray notice — replaces the old red banner. Sits above the cutout. */}
      {notice && phase === "scanning" && (
        <div style={{position:"absolute",bottom:`calc(50% + ${CUTOUT/2}px + 18px)`,left:"50%",transform:"translateX(-50%)",padding:"10px 14px",background:"rgba(0,0,0,0.65)",color:"#fff",fontFamily:FONT,fontSize:12,borderRadius:10,maxWidth:"calc(100vw - 32px)",textAlign:"center",backdropFilter:"blur(6px)",zIndex:5}}>
          {notice}
        </div>
      )}

      {/* Hidden file inputs. Reset value after each pick so re-selecting the
          same file still fires onChange. */}
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={e => { pickFile(e.target.files[0]); e.target.value = ""; }}/>
      <input ref={galleryInputRef} type="file" accept="image/*" style={{display:"none"}} onChange={e => { pickFile(e.target.files[0]); e.target.value = ""; }}/>
      <input ref={filesInputRef} type="file" accept="image/*,application/pdf" style={{display:"none"}} onChange={e => { pickFile(e.target.files[0]); e.target.value = ""; }}/>
      <input ref={ocrFileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{display:"none"}} onChange={e => { handleOcrPick(e.target.files[0]); e.target.value = ""; }}/>

      {/* Bottom pill — white, rounded top, contents swap per phase. Hidden in
          the preview screen, which has its own controls. */}
      {phase !== "preview" && (
      <div style={{position:"absolute",bottom:0,left:0,right:0,background:"#fff",borderRadius:"20px 20px 0 0",padding:"18px 16px calc(20px + env(safe-area-inset-bottom))",display:"flex",flexDirection:"column",gap:12,zIndex:6,boxShadow:"0 -4px 20px rgba(0,0,0,0.15)"}}>
        {phase === "scanning" && <>
          <button type="button"
            onClick={(e) => { e.preventDefault(); setNotice(""); cameraInputRef.current?.click(); }}
            onPointerDown={e => { e.currentTarget.style.opacity = "0.7"; }}
            onPointerUp={e => { e.currentTarget.style.opacity = "1"; }}
            onPointerLeave={e => { e.currentTarget.style.opacity = "1"; }}
            style={{width:"100%",height:52,borderRadius:12,background:"#fff",border:"1px solid #EEF0F4",display:"flex",alignItems:"center",justifyContent:"center",gap:10,fontFamily:FONT,fontSize:15,fontWeight:500,color:"#111318",cursor:"pointer",transition:"opacity 100ms"}}>
            <Camera size={20} color="#111318"/> Сделать фото
          </button>
          <button type="button" onClick={openSheet}
            onPointerDown={e => { e.currentTarget.style.opacity = "0.7"; }}
            onPointerUp={e => { e.currentTarget.style.opacity = "1"; }}
            onPointerLeave={e => { e.currentTarget.style.opacity = "1"; }}
            style={{width:"100%",height:52,borderRadius:12,background:"#fff",border:"1px solid #EEF0F4",display:"flex",alignItems:"center",justifyContent:"center",gap:10,fontFamily:FONT,fontSize:15,fontWeight:400,color:"#636B7D",cursor:"pointer",transition:"opacity 100ms"}}>
            <ImageUp size={20} color="#636B7D"/> Загрузить
          </button>
          <button type="button" onClick={(e) => { e.preventDefault(); onManual(); }}
            style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,background:"none",border:"none",cursor:"pointer",padding:"4px",fontFamily:FONT,fontSize:13,color:"#9CA3AF"}}>
            <PenLine size={16} color="#9CA3AF"/> Ввести вручную
          </button>
        </>}

        {phase === "captured" && (
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontFamily:FONT,fontSize:11,color:C.gray,marginBottom:3,letterSpacing:"0.02em"}}>Чек распознан</div>
              <div style={{fontFamily:FONT,fontSize:15,fontWeight:600,color:C.dark,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                {qrParsed?.amount ? `${Number(qrParsed.amount).toLocaleString("ru-RU",{minimumFractionDigits:2})} ₽` : "QR-код"}
                {qrParsed?.date ? ` · ${fmtDate(qrParsed.date)}` : ""}
              </div>
            </div>
            <button type="button" onClick={cancel}
              style={{flexShrink:0,padding:"10px 18px",background:C.lightGray,border:"none",borderRadius:10,fontFamily:FONT,fontSize:13,color:C.mid,cursor:"pointer"}}>
              Отмена
            </button>
          </div>
        )}

        {phase === "loading" && (
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
            <div style={{display:"flex",alignItems:"center",gap:10,flex:1,minWidth:0}}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.cherry} strokeWidth="2.5" style={{flexShrink:0}}>
                <circle cx="12" cy="12" r="9" strokeOpacity="0.2"/>
                <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round">
                  <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>
                </path>
              </svg>
              <span style={{fontFamily:FONT,fontSize:14,color:C.dark,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{loadingMsg}</span>
            </div>
            <button type="button" onClick={cancel}
              style={{flexShrink:0,padding:"10px 18px",background:C.lightGray,border:"none",borderRadius:10,fontFamily:FONT,fontSize:13,color:C.mid,cursor:"pointer"}}>
              Отмена
            </button>
          </div>
        )}

        {phase === "fnsError" && <>
          <div style={{textAlign:"center",color:C.gray,fontFamily:FONT,fontSize:13,marginBottom:2}}>
            Данные ФНС не загрузились
          </div>
          {onOcrFile && (
            <button type="button" onClick={(e) => { e.preventDefault(); ocrFileRef.current?.click(); }}
              style={{padding:"14px",background:C.cherry,border:"none",borderRadius:12,fontFamily:FONT,fontSize:14,fontWeight:600,color:C.white,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
              <span style={{fontSize:16}}>📷</span> Распознать фото чека
            </button>
          )}
          <button type="button" onClick={(e) => { e.preventDefault(); cancelledRef.current = false; runFnsLoad(qrText); }}
            style={{padding:"12px",background:C.white,border:`1px solid ${C.silver}`,borderRadius:12,fontFamily:FONT,fontSize:13,color:C.dark,cursor:"pointer"}}>
            Попробовать снова
          </button>
          <button type="button" onClick={(e) => { e.preventDefault(); onManual(qrText); }}
            style={{padding:"12px",background:"none",border:"none",fontFamily:FONT,fontSize:13,color:C.gray,cursor:"pointer"}}>
            Заполнить вручную
          </button>
        </>}

        {phase === "cameraError" && (
          <button type="button" onClick={(e) => { e.preventDefault(); onManual(); }}
            style={{padding:"14px",background:C.cherry,border:"none",borderRadius:12,fontFamily:FONT,fontSize:14,fontWeight:600,color:C.white,cursor:"pointer"}}>
            Ввести вручную
          </button>
        )}
      </div>
      )}

      {/* Photo-source bottom sheet — gallery / files / cancel ("Сделать фото"
          is now a dedicated button in the scanning panel). */}
      {sheetOpen && (
        <div onClick={closeSheet} style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.5)",zIndex:20,display:"flex",alignItems:"flex-end"}}>
          <div onClick={e => e.stopPropagation()}
            style={{width:"100%",background:C.white,borderRadius:"16px 16px 0 0",padding:"8px 12px calc(12px + env(safe-area-inset-bottom))",display:"flex",flexDirection:"column"}}>
            <div style={{alignSelf:"center",width:40,height:4,borderRadius:2,background:C.silver,margin:"6px 0 8px"}}/>
            {[
              {icon:"🖼", label:"Выбрать из галереи", ref:galleryInputRef},
              {icon:"📄", label:"Выбрать из файлов",  ref:filesInputRef},
            ].map(opt => (
              <button key={opt.label} type="button"
                onClick={(e) => { e.preventDefault(); opt.ref.current?.click(); }}
                style={{display:"flex",alignItems:"center",gap:14,padding:"15px 8px",background:"none",border:"none",borderBottom:`1px solid ${C.lightGray}`,fontFamily:FONT,fontSize:15,color:C.dark,cursor:"pointer",textAlign:"left",width:"100%"}}>
                <span style={{fontSize:20,width:24,textAlign:"center"}}>{opt.icon}</span>{opt.label}
              </button>
            ))}
            <button type="button" onClick={closeSheet}
              style={{display:"flex",alignItems:"center",gap:14,padding:"15px 8px",marginTop:4,background:"none",border:"none",fontFamily:FONT,fontSize:15,color:C.gray,cursor:"pointer",textAlign:"left",width:"100%"}}>
              <span style={{fontSize:20,width:24,textAlign:"center"}}>✕</span>Отмена
            </button>
          </div>
        </div>
      )}

      {/* Preview screen — chosen photo full-screen, confirm or retake */}
      {phase === "preview" && (
        <div style={{position:"absolute",inset:0,background:"#000",zIndex:15,display:"flex",flexDirection:"column"}}>
          <div style={{flex:1,minHeight:0,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
            {previewUrl
              ? <img src={previewUrl} alt="Предпросмотр чека" style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain"}}/>
              : <div style={{color:"#fff",fontFamily:FONT,fontSize:14,textAlign:"center",padding:24,display:"flex",flexDirection:"column",alignItems:"center",gap:12}}>
                  <span style={{fontSize:52}}>📄</span>
                  <span style={{opacity:0.85,wordBreak:"break-all"}}>{previewFile?.name || "Файл выбран"}</span>
                </div>}
          </div>

          {/* Back button */}
          <div style={{position:"absolute",top:0,left:0,padding:"calc(env(safe-area-inset-top) + 12px) 16px 12px"}}>
            <button type="button" onClick={previewBack} aria-label="Назад"
              style={{width:44,height:44,borderRadius:"50%",border:"none",background:"rgba(0,0,0,0.45)",color:"#fff",fontSize:26,lineHeight:1,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(8px)"}}>‹</button>
          </div>

          {/* Bottom controls */}
          <div style={{padding:"18px 16px calc(20px + env(safe-area-inset-bottom))",background:"linear-gradient(to top, rgba(0,0,0,0.7), transparent)"}}>
            {previewBusy ? (
              <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:12,color:"#fff",fontFamily:FONT,fontSize:14}}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="9" strokeOpacity="0.25"/>
                  <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round">
                    <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>
                  </path>
                </svg>
                Отправляем на распознавание…
              </div>
            ) : previewNotice ? (
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <div style={{textAlign:"center",color:"#fff",fontFamily:FONT,fontSize:13,background:"rgba(255,255,255,0.14)",borderRadius:10,padding:"10px 14px"}}>{previewNotice}</div>
                <button type="button" onClick={(e) => { e.preventDefault(); onManual(); }}
                  style={{padding:"14px",background:C.cherry,border:"none",borderRadius:12,fontFamily:FONT,fontSize:14,fontWeight:600,color:C.white,cursor:"pointer"}}>
                  Заполнить вручную
                </button>
                <button type="button" onClick={previewRetake}
                  style={{padding:"12px",background:"rgba(255,255,255,0.12)",border:"1px solid rgba(255,255,255,0.4)",borderRadius:12,fontFamily:FONT,fontSize:13,color:"#fff",cursor:"pointer"}}>
                  Переснять
                </button>
              </div>
            ) : (
              <div style={{display:"flex",gap:12}}>
                <button type="button" onClick={previewRetake}
                  style={{flex:1,padding:"14px",background:"rgba(255,255,255,0.12)",border:"1px solid rgba(255,255,255,0.4)",borderRadius:12,fontFamily:FONT,fontSize:14,color:"#fff",cursor:"pointer"}}>
                  Переснять
                </button>
                <button type="button" onClick={usePhoto}
                  style={{flex:1,padding:"14px",background:C.cherry,border:"none",borderRadius:12,fontFamily:FONT,fontSize:14,fontWeight:600,color:C.white,cursor:"pointer"}}>
                  Использовать
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Donut({title,data,num}) {
  const pal=[C.cherry,C.cherryM,"#C45558","#E8A0A2","#D4888A"];
  const sectionTotal=data.reduce((s,d)=>s+d.value,0);
  return (
    <SectionCard title={title} num={num}>
      {data.length>1&&(
        <div style={{position:"relative",height:160}}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" cx="50%" cy="50%" innerRadius={54} outerRadius={75} paddingAngle={2} startAngle={90} endAngle={-270}>
                {data.map((_,i)=><Cell key={i} fill={pal[i%pal.length]}/>)}
              </Pie>
              <Tooltip formatter={v=>fmt(v)} contentStyle={{background:C.white,border:`1px solid ${C.silver}`,fontFamily:FONT,fontSize:11}}/>
            </PieChart>
          </ResponsiveContainer>
          <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",pointerEvents:"none"}}>
            <span style={{fontSize:11,color:"#636B7D",fontFamily:FONT}}>Итого</span>
            <span style={{fontSize:13,fontWeight:600,color:C.dark,fontFamily:FONT,fontVariantNumeric:"tabular-nums",whiteSpace:"nowrap"}}>{fmt(sectionTotal)}</span>
          </div>
        </div>
      )}
      <div style={{display:"flex",flexWrap:"wrap",gap:"6px 14px",padding:"8px 0 2px"}}>
        {data.map((d,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:5,whiteSpace:"nowrap"}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:pal[i%pal.length],flexShrink:0}}/>
            <span style={{fontSize:11,color:C.dark,fontFamily:FONT}}>{d.name}</span>
            <span style={{fontSize:12,fontWeight:500,color:C.gray,fontFamily:FONT,fontVariantNumeric:"tabular-nums"}}>{fmt(d.value)}</span>
          </div>
        ))}
      </div>
      {data.length===0&&<div style={{fontSize:12,color:C.grayL,fontFamily:FONT,padding:"6px 0"}}>Нет данных за период</div>}
    </SectionCard>
  );
}

// ─── PAGES ────────────────────────────────────────────────

function SvodkaPage({receipts, activePeriod, setActivePeriod, users, cards}) {
  const [showFilters,setShowFilters]=useState(false);
  const [selEmployee,setSelEmployee]=useState(null);
  const [cats,setCats]=useState([]);
  const [selCards,setSelCards]=useState([]);
  const filtersActive=!!selEmployee||cats.length>0||selCards.length>0;

  const filtered=receipts.filter(r=>{
    if(!inPeriod(r.date, activePeriod)) return false;
    if(selEmployee && (r.employee||"Алексей Шукалович")!==selEmployee) return false;
    if(cats.length>0 && !cats.includes(r.category)) return false;
    if(selCards.length>0 && !selCards.includes(r.payment)) return false;
    return true;
  });

  const total=filtered.reduce((s,r)=>s+Number(r.amount),0);
  const orgMap={},payMap={},catMap={},empMap={};
  filtered.forEach(r=>{
    if(!orgMap[r.org])orgMap[r.org]={value:0,count:0}; orgMap[r.org].value+=Number(r.amount); orgMap[r.org].count++;
    if(!payMap[r.payment])payMap[r.payment]={value:0,count:0}; payMap[r.payment].value+=Number(r.amount); payMap[r.payment].count++;
    if(!catMap[r.category])catMap[r.category]={value:0,count:0}; catMap[r.category].value+=Number(r.amount); catMap[r.category].count++;
    const e=r.employee||"Алексей Шукалович";
    if(!empMap[e])empMap[e]={value:0,count:0}; empMap[e].value+=Number(r.amount); empMap[e].count++;
  });
  const catSorted=Object.entries(catMap).sort((a,b)=>b[1].value-a[1].value);
  const topCat=catSorted[0];
  const subLine=topCat&&total>0?`${Math.round(topCat[1].value/total*100)}% · ${topCat[0]}`:"Нет данных за период";
  const empData=Object.entries(empMap).map(([name,d])=>({name,...d}));
  const pal=[C.cherry,C.cherryM,"#C45558","#E8A0A2","#D4888A"];

  return (
    <div style={{paddingBottom:"calc(env(safe-area-inset-bottom) + 80px)"}}>
      <div style={{background:C.white,borderBottom:`1px solid ${C.silver}`,padding:"10px 16px"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{flex:1,minWidth:0}}>
            <SegmentedControl
              segments={PERIOD_OPTIONS.map(o=>o.label)}
              active={periodLabel(activePeriod)}
              onChange={l=>setActivePeriod(periodKey(l))}/>
          </div>
          <div style={{flexShrink:0,display:"flex",alignItems:"center",gap:8}}>
            <FilterIcon active={filtersActive} onClick={()=>setShowFilters(true)}/>
          </div>
        </div>
      </div>
      <div style={{padding:"12px 16px"}}>
        <div style={{background:C.white,border:`1px solid ${C.silver}`,padding:"12px 16px",marginBottom:10,borderLeft:"3px solid #A4161A",borderRadius:6}}>
          <div style={{fontSize:10,letterSpacing:"0.1em",textTransform:"uppercase",color:"#636B7D",marginBottom:6,fontFamily:FONT}}>Итого за период</div>
          <div style={{fontSize:30,fontWeight:700,color:"#111318",fontFamily:FONT,fontVariantNumeric:"tabular-nums",lineHeight:1.1,marginBottom:4}}>{fmt(total)}</div>
          <div style={{fontSize:12,color:"#636B7D",fontFamily:FONT}}>{subLine}</div>
        </div>
        <SectionCard title="Сотрудники">
          {empData.map((d,i)=>(
            <div key={i}
              style={{height:44,display:"flex",alignItems:"center",gap:10,borderBottom:i<empData.length-1?`0.5px solid ${C.silver}`:"none"}}>
              <div style={{width:8,height:8,background:pal[i%pal.length],flexShrink:0}}/>
              <span style={{flex:1,minWidth:0,fontSize:14,fontWeight:500,color:C.dark,fontFamily:FONT,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{d.name}</span>
              <span style={{fontSize:12,color:"#636B7D",fontFamily:FONT,flexShrink:0}}>{d.count}</span>
              <span style={{fontSize:14,fontWeight:600,color:"#A4161A",fontFamily:FONT,fontVariantNumeric:"tabular-nums",flexShrink:0}}>{fmt(d.value)}</span>
            </div>
          ))}
          {empData.length===0&&<div style={{fontSize:12,color:C.grayL,fontFamily:FONT,padding:"10px 0"}}>Нет данных за период</div>}
        </SectionCard>
        <Donut title="Организации" data={Object.entries(orgMap).map(([name,d])=>({name:shortOrg(name),...d}))}/>
        <Donut title="Методы оплаты" data={Object.entries(payMap).map(([name,d])=>({name,...d}))}/>
        <Donut title="Категории" data={Object.entries(catMap).map(([name,d])=>({name,...d}))}/>
      </div>
      {showFilters&&<FiltersModal
        employees={users}
        selectedEmployee={selEmployee}
        categories={CATEGORIES}
        cards={cards}
        selectedCats={cats}
        selectedCards={selCards}
        onApply={r=>{ setSelEmployee(r.employee); setCats(r.cats); setSelCards(r.cards); }}
        onReset={()=>{ setSelEmployee(null); setCats([]); setSelCards([]); }}
        onClose={()=>setShowFilters(false)}/>}
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
const SOURCE_LABELS = {fns:"ФНС", qr_scan:"QR", photo_ocr:"Фото", manual:"Вручную"};
const sourceLabel = s => SOURCE_LABELS[s] || null;

function SwipeableReceiptCard({receipt, onClick, onDelete}) {
  const [tx,setTx]=useState(0);
  const startX=useRef(0);
  const startY=useRef(0);
  const dragging=useRef(false);
  const moved=useRef(false);
  const locked=useRef(null);

  const r=receipt;
  const col=catColor(r.category);
  const REVEAL=72;
  const card4=getCardLast4(r.raw_data);
  const payment=shortPayment(r.payment);

  function onPointerDown(e) {
    dragging.current=true;
    moved.current=false;
    locked.current=null;
    startX.current=e.clientX;
    startY.current=e.clientY;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e) {
    if(!dragging.current) return;
    const dx=e.clientX-startX.current;
    const dy=e.clientY-startY.current;
    if(locked.current===null) {
      if(Math.abs(dx)>6||Math.abs(dy)>6) {
        locked.current=Math.abs(dx)>Math.abs(dy)?"x":"y";
      } else return;
    }
    if(locked.current!=="x") return;
    moved.current=true;
    const base=tx<0?-REVEAL:0;
    const next=Math.min(0,Math.max(-REVEAL,base+dx));
    setTx(next);
  }
  function onPointerUp() {
    if(!dragging.current) return;
    dragging.current=false;
    if(locked.current==="x") {
      setTx(tx<-REVEAL/2?-REVEAL:0);
    }
  }
  function handleTap() {
    if(moved.current) return;
    if(tx<0) { setTx(0); return; }
    onClick?.();
  }

  return (
    <div style={{position:"relative",background:"#B91C1C",overflow:"hidden"}}>
      <div onClick={onDelete} style={{position:"absolute",top:0,right:0,bottom:0,width:REVEAL,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
      </div>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={handleTap}
        style={{
          background:C.white,padding:"11px 14px",display:"flex",alignItems:"center",gap:12,
          transform:`translateX(${tx}px)`,transition:dragging.current?"none":"transform 0.2s ease",
          cursor:"pointer",userSelect:"none",touchAction:"pan-y"
        }}>
        <div style={{width:38,height:38,borderRadius:"50%",background:col.bg,color:col.fg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:FONT,fontSize:15,fontWeight:700,flexShrink:0}}>{orgInitial(r.org)}</div>
        <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",justifyContent:"center",gap:4}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{flex:1,minWidth:0,fontSize:14,fontFamily:FONT,color:C.dark,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{shortOrg(r.org)}</span>
            <span style={{fontSize:15,fontFamily:FONT,color:C.dark,fontWeight:700,flexShrink:0}}>{fmt(r.amount)}</span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:"#636B7D",fontFamily:FONT,minWidth:0}}>
            <span style={{display:"inline-block",padding:"2px 8px",borderRadius:20,background:col.bg,color:col.fg,fontSize:10,fontWeight:600,whiteSpace:"nowrap",flexShrink:0}}>{r.category||"Не указано"}</span>
            <span style={{flexShrink:0}}>·</span>
            <span style={{whiteSpace:"nowrap",flexShrink:0}}>{fmtDate(r.date)}</span>
            {sourceLabel(r.source)&&<span style={{fontSize:10,color:"#636B7D",whiteSpace:"nowrap",flexShrink:0}}>· {sourceLabel(r.source)}</span>}
            <span style={{flexShrink:0}}>·</span>
            <span style={{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",minWidth:0}}>{payment}{card4?` •••${card4}`:""}</span>
            <span style={{flex:1}}/>
            <span style={{color:"#9CA3AF",fontSize:20,fontWeight:600,flexShrink:0,lineHeight:1}}>›</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReceiptDetailModal({receipt, onClose, onDelete, onChangeCategory, onChangePayment, paymentOptions=[]}) {
  const [confirm,setConfirm]=useState(false);
  const [showCat,setShowCat]=useState(false);
  const [showPay,setShowPay]=useState(false);
  const r=receipt;
  const raw=r.raw_data||{};

  const inn=raw.userInn||raw.inn||"";
  const address=raw.retailPlaceAddress||raw.retailPlace||"";
  const place=raw.retailPlace||raw.retailPlaceAddress||"";
  const dateTime=raw.dateTime?fmtDateTime(raw.dateTime*1000):"";
  const fdNum=raw.fiscalDocumentNumber||r.fd||"";
  const shift=raw.shiftNumber||"";
  const reqNum=raw.requestNumber||"";
  const items=Array.isArray(raw.items)?raw.items:[];
  const totalSum=raw.totalSum?raw.totalSum/100:Number(r.amount);
  const cashSum=raw.cashTotalSum?raw.cashTotalSum/100:null;
  const cardSum=raw.ecashTotalSum?raw.ecashTotalSum/100:null;
  const ndsSum=raw.nds18?raw.nds18/100:(raw.nds20?raw.nds20/100:null);
  const ndsSum10=raw.nds10?raw.nds10/100:null;
  const taxKind=raw.appliedTaxationType!==undefined?["Общая","УСН доход","УСН доход-расход","ЕНВД","ЕСХН","Патент"][raw.appliedTaxationType]||String(raw.appliedTaxationType):"";
  const kktReg=raw.kktRegId||"";
  const fnNum=raw.fiscalDriveNumber||r.fn||"";
  const fpd=raw.fiscalSign||r.fpd||"";

  const dashed={borderTop:`1px dashed ${C.silver}`,margin:"8px 0"};
  const row=(label,value)=>value?(
    <div style={{display:"flex",justifyContent:"space-between",gap:8,padding:"3px 0",fontSize:12,fontFamily:"'Courier New', Courier, monospace",color:C.dark}}>
      <span style={{color:C.gray}}>{label}</span>
      <span style={{textAlign:"right",wordBreak:"break-all"}}>{value}</span>
    </div>
  ):null;

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(22,26,29,0.5)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:150}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.white,width:"100%",maxWidth:480,maxHeight:"calc(100dvh - env(safe-area-inset-top) - 8px)",display:"flex",flexDirection:"column",borderRadius:"16px 16px 0 0",overflow:"hidden"}}>
        <div style={{padding:"12px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:`1px solid ${C.silver}`,background:C.white,flexShrink:0}}>
          <button onClick={onClose} style={{border:"none",background:"none",color:C.dark,cursor:"pointer",fontSize:20,padding:4}}>‹</button>
          <span style={{fontSize:14,fontFamily:FONT,color:C.dark,fontWeight:600}}>Детали документа</span>
          <button onClick={onClose} style={{border:"none",background:"none",color:C.gray,cursor:"pointer",fontSize:18,padding:4}}>✕</button>
        </div>

        <div style={{flex:1,overflow:"auto",background:"#FAF9F6"}}>
          <div style={{margin:"14px 14px 8px",background:"#FFFEFB",border:`1px solid ${C.silver}`,padding:"18px 16px",fontFamily:"'Courier New', Courier, monospace",color:C.dark,boxShadow:"0 2px 12px rgba(0,0,0,0.06)",borderRadius:8}}>
            <div style={{textAlign:"center",fontSize:13,fontWeight:700,letterSpacing:"0.15em",marginBottom:8}}>КАССОВЫЙ ЧЕК</div>
            {r.org&&<div style={{textAlign:"center",fontSize:13,fontWeight:700,marginBottom:6}}>{shortOrg(r.org)}</div>}
            {address&&<div style={{textAlign:"center",fontSize:11,color:C.mid,marginBottom:2}}>{address}</div>}
            {place&&place!==address&&<div style={{textAlign:"center",fontSize:11,color:C.mid,marginBottom:2}}>{place}</div>}
            {inn&&<div style={{textAlign:"center",fontSize:11,color:C.mid,marginBottom:6}}>ИНН {inn}</div>}
            <div style={dashed}/>
            {row("Дата:", dateTime||fmtDate(r.date))}
            {row("Чек №:", fdNum)}
            {row("Смена №:", shift)}
            {row("Запрос №:", reqNum)}
            <div style={dashed}/>
            <div style={{textAlign:"center",fontSize:12,fontWeight:700,letterSpacing:"0.1em",margin:"4px 0"}}>ПРИХОД</div>
            <div style={dashed}/>
            {items.length>0?items.map((it,i)=>{
              const qty=it.quantity||1;
              const price=(it.price||0)/100;
              const sum=(it.sum||0)/100;
              return (
                <div key={i} style={{padding:"4px 0",fontSize:12}}>
                  <div style={{color:C.dark,marginBottom:2}}>{i+1}. {it.name||"—"}</div>
                  <div style={{display:"flex",justifyContent:"space-between",color:C.gray,fontSize:11}}>
                    <span>{qty} × {price.toLocaleString("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
                    <span style={{color:C.dark}}>= {sum.toLocaleString("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
                  </div>
                  {it.nds!==undefined&&<div style={{fontSize:10,color:C.grayL}}>НДС: {it.nds}</div>}
                </div>
              );
            }):<div style={{fontSize:11,color:C.gray,textAlign:"center",padding:"6px 0"}}>Состав чека недоступен</div>}
            <div style={dashed}/>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",fontSize:14,fontWeight:700,marginTop:4}}>
              <span>ИТОГО:</span>
              <span style={{fontSize:18}}>{totalSum.toLocaleString("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:2})} ₽</span>
            </div>
            <div style={dashed}/>
            {row("НДС 20%:", ndsSum?ndsSum.toLocaleString("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:2}):"")}
            {row("НДС 10%:", ndsSum10?ndsSum10.toLocaleString("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:2}):"")}
            {row("Наличные:", cashSum!==null?cashSum.toLocaleString("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:2}):"")}
            {row("Картой:", cardSum!==null?cardSum.toLocaleString("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:2}):"")}
            {row("Метод оплаты:", r.payment||"Не указано")}
            {(taxKind||kktReg||fnNum||fpd||fdNum)&&<div style={dashed}/>}
            {row("СНО:", taxKind)}
            {row("РН ККТ:", kktReg)}
            {row("ФН №:", fnNum)}
            {row("ФД №:", fdNum)}
            {row("ФПД:", fpd)}
          </div>

          <div style={{padding:"12px 14px calc(14px + env(safe-area-inset-bottom))",display:"flex",flexDirection:"column",gap:8}}>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setShowCat(true)} style={{flex:1,padding:"12px 8px",background:C.white,border:`1px solid ${C.silver}`,fontFamily:FONT,fontSize:13,color:C.dark,cursor:"pointer",borderRadius:10,fontWeight:600}}>Изменить категорию</button>
              {onChangePayment&&(
                <button onClick={()=>setShowPay(true)} style={{flex:1,padding:"12px 8px",background:C.white,border:`1px solid ${C.silver}`,fontFamily:FONT,fontSize:13,color:C.dark,cursor:"pointer",borderRadius:10,fontWeight:600}}>Изменить карту</button>
              )}
            </div>
            {!confirm?(
              <button onClick={()=>setConfirm(true)} style={{padding:"12px",background:"#FEF2F2",border:`1px solid #FECACA`,fontFamily:FONT,fontSize:13,color:"#B91C1C",cursor:"pointer",borderRadius:10,fontWeight:600}}>Удалить чек</button>
            ):(
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>setConfirm(false)} style={{flex:1,padding:"12px",background:C.white,border:`1px solid ${C.silver}`,fontFamily:FONT,fontSize:13,color:C.dark,cursor:"pointer",borderRadius:10}}>Отмена</button>
                <button onClick={onDelete} style={{flex:1,padding:"12px",background:"#B91C1C",border:"none",fontFamily:FONT,fontSize:13,color:C.white,cursor:"pointer",borderRadius:10,fontWeight:600}}>Удалить</button>
              </div>
            )}
          </div>
        </div>

        {showCat&&(
          <div onClick={()=>setShowCat(false)} style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.4)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:10}}>
            <div onClick={e=>e.stopPropagation()} style={{background:C.white,width:"100%",borderRadius:"14px 14px 0 0",padding:"14px 16px 18px"}}>
              <div style={{fontSize:13,fontFamily:FONT,color:C.dark,fontWeight:700,marginBottom:10}}>Категория</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {CATEGORIES.map(c=>{
                  const col=catColor(c);
                  const sel=r.category===c;
                  return (
                    <button key={c} onClick={()=>{onChangeCategory(c);setShowCat(false);}} style={{
                      padding:"7px 12px",border:`1px solid ${sel?col.fg:C.silver}`,
                      background:sel?col.bg:C.white,color:sel?col.fg:C.dark,
                      fontFamily:FONT,fontSize:12,cursor:"pointer",borderRadius:8,fontWeight:sel?700:500
                    }}>{c}</button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {showPay&&(
          <div onClick={()=>setShowPay(false)} style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.4)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:10}}>
            <div onClick={e=>e.stopPropagation()} style={{background:C.white,width:"100%",borderRadius:"14px 14px 0 0",padding:"14px 0 calc(18px + env(safe-area-inset-bottom))",maxHeight:"60vh",display:"flex",flexDirection:"column"}}>
              <div style={{fontSize:13,fontFamily:FONT,color:C.dark,fontWeight:700,margin:"0 16px 10px"}}>Метод оплаты</div>
              <div style={{overflow:"auto"}}>
                {paymentOptions.map(opt=>{
                  const sel=r.payment===opt;
                  return (
                    <button key={opt} onClick={()=>{onChangePayment(opt);setShowPay(false);}} style={{
                      width:"100%",padding:"13px 16px",border:"none",borderBottom:`0.5px solid ${C.silver}`,
                      background:sel?C.cherryL:C.white,color:sel?C.cherry:C.dark,
                      fontFamily:FONT,fontSize:14,cursor:"pointer",textAlign:"left",
                      display:"flex",alignItems:"center",justifyContent:"space-between",
                      fontWeight:sel?600:500
                    }}>
                      <span>{opt}</span>
                      {sel&&<span style={{color:C.cherry,fontSize:16}}>✓</span>}
                    </button>
                  );
                })}
                {paymentOptions.length===0&&(
                  <div style={{padding:"20px 16px",fontFamily:FONT,fontSize:12,color:C.grayL,textAlign:"center"}}>
                    Нет доступных карт
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FiltersModal({dateBuilder,from,to,employees,selectedEmployee,categories,selectedCats,cards,selectedCards,sources,onApply,onReset,onClose}) {
  const hasEmp=employees!==undefined;
  const hasCats=categories!==undefined;
  const hasCards=cards!==undefined;
  const hasSource=sources!==undefined;

  const [pFrom,setPFrom]=useState(from||monthStartISO());
  const [pTo,setPTo]=useState(to||todayISO());
  const [selEmp,setSelEmp]=useState(selectedEmployee||null);
  const [selCats,setSelCats]=useState(selectedCats||[]);
  const [selCards,setSelCards]=useState(selectedCards||[]);
  const [selSources,setSelSources]=useState(sources||[]);
  const [shown,setShown]=useState(false);
  useEffect(()=>{ const id=requestAnimationFrame(()=>setShown(true)); return ()=>cancelAnimationFrame(id); },[]);

  const toggleIn=(arr,setArr,val)=>{ if(val===null){setArr([]);return;} setArr(prev=>prev.includes(val)?prev.filter(x=>x!==val):[...prev,val]); };
  const isOn=(arr,val)=>val===null?arr.length===0:arr.includes(val);

  const inputStyle={width:"100%",padding:"10px 12px",border:`1px solid ${C.silver}`,borderRadius:8,fontSize:13,fontFamily:FONT,color:C.dark,background:C.white,boxSizing:"border-box"};
  const labelStyle={fontSize:11,color:C.gray,fontFamily:FONT,marginBottom:8,letterSpacing:"0.05em",textTransform:"uppercase"};
  const chip=on=>({padding:"6px 12px",border:"none",borderRadius:8,cursor:"pointer",fontFamily:FONT,fontSize:12,fontWeight:on?600:500,background:on?"#A4161A":"#EEF0F4",color:on?"#fff":"#636B7D",display:"inline-flex",alignItems:"center",gap:6});

  const empName=u=>(`${u.first_name||""} ${u.last_name||""}`).trim()||u.email||"—";
  const cardNames=hasCards?cards.map(c=>c.name).concat("Наличные"):[];

  const EASE="cubic-bezier(0.32, 0.72, 0, 1)";
  const close=()=>{ setShown(false); setTimeout(onClose, 220); };  // play exit, then unmount
  const apply=()=>{ onApply({from:pFrom,to:pTo,employee:selEmp,cats:selCats,cards:selCards,sources:selSources}); close(); };
  const reset=()=>{ onReset(); close(); };

  return (
    <div onClick={close} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.3)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:120,opacity:shown?1:0,transition:`opacity ${shown?280:220}ms ease`}}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.white,width:"100%",maxWidth:480,borderRadius:"16px 16px 0 0",display:"flex",flexDirection:"column",maxHeight:"88dvh",paddingBottom:"env(safe-area-inset-bottom)",transform:shown?"translateY(0)":"translateY(100%)",transition:`transform ${shown?280:220}ms ${EASE}`}}>
        <div style={{display:"flex",justifyContent:"center",padding:"8px 0 2px",flexShrink:0}}>
          <div style={{width:36,height:4,borderRadius:2,background:"#D5D7DD"}}/>
        </div>
        <div style={{padding:"4px 16px 12px",borderBottom:`1px solid ${C.silver}`,display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
          <span style={{fontSize:15,fontFamily:FONT,color:C.dark,fontWeight:600}}>Фильтры</span>
          <button onClick={close} style={{border:"none",background:"none",color:C.gray,fontSize:18,cursor:"pointer"}}>✕</button>
        </div>
        <div style={{padding:"16px",overflow:"auto",flex:1,display:"flex",flexDirection:"column",gap:18}}>
          {dateBuilder&&(
            <div>
              <div style={labelStyle}>Период</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div>
                  <div style={{fontSize:10,color:C.gray,fontFamily:FONT,marginBottom:4}}>От</div>
                  <input type="date" value={pFrom} onChange={e=>setPFrom(e.target.value)} style={inputStyle}/>
                </div>
                <div>
                  <div style={{fontSize:10,color:C.gray,fontFamily:FONT,marginBottom:4}}>До</div>
                  <input type="date" value={pTo} onChange={e=>setPTo(e.target.value)} style={inputStyle}/>
                </div>
              </div>
            </div>
          )}

          {hasEmp&&(
            <div>
              <div style={labelStyle}>Сотрудник</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                {[["Все сотрудники",null],...employees.map(u=>[empName(u),empName(u)])].map(([label,val])=>(
                  <button key={val||"all"} onClick={()=>setSelEmp(val)} style={chip(val===null?!selEmp:selEmp===val)}>{label}</button>
                ))}
              </div>
            </div>
          )}

          {hasCats&&(
            <div>
              <div style={labelStyle}>Категория</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                {[["Все",null],...categories.map(c=>[c,c])].map(([label,val])=>(
                  <button key={label} onClick={()=>toggleIn(selCats,setSelCats,val)} style={chip(isOn(selCats,val))}>
                    {val&&<span style={{width:8,height:8,borderRadius:"50%",background:catColor(val).fg,flexShrink:0}}/>}
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {hasCards&&(
            <div>
              <div style={labelStyle}>Карта</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                {[["Все",null],...cardNames.map(n=>[shortPayment(n),n])].map(([label,val])=>(
                  <button key={val||"all"} onClick={()=>toggleIn(selCards,setSelCards,val)} style={chip(isOn(selCards,val))}>{label}</button>
                ))}
              </div>
            </div>
          )}

          {hasSource&&(
            <div>
              <div style={labelStyle}>Источник</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                {[["Все",null],["ФНС","fns"],["QR","qr_scan"],["Фото","photo_ocr"],["Вручную","manual"]].map(([label,val])=>(
                  <button key={label} onClick={()=>toggleIn(selSources,setSelSources,val)} style={chip(isOn(selSources,val))}>{label}</button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div style={{padding:"12px 16px",display:"flex",gap:8,borderTop:`1px solid ${C.silver}`,flexShrink:0}}>
          <button onClick={reset} title="Сбросить" style={{width:44,height:44,border:`1px solid ${C.silver}`,background:C.white,color:C.gray,cursor:"pointer",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
          </button>
          <button onClick={apply} style={{flex:1,padding:"12px",background:C.cherry,border:"none",fontFamily:FONT,fontSize:13,color:C.white,cursor:"pointer",borderRadius:10,fontWeight:600,letterSpacing:"0.04em"}}>Применить</button>
        </div>
      </div>
    </div>
  );
}

function FilterIcon({active,onClick,size=38}) {
  const stroke=active?C.cherry:"#636B7D";
  return (
    <button onClick={onClick} style={{position:"relative",width:size,height:size,border:"none",background:active?C.cherryL:"#EEF0F4",cursor:"pointer",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M2 4h12M4 8h8M6 12h4" stroke={stroke} strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
      {active&&<span style={{position:"absolute",top:6,right:6,width:7,height:7,borderRadius:"50%",background:C.cherry,border:"1.5px solid #fff"}}/>}
    </button>
  );
}

// Compact period picker pill with a dropdown — Operacii header.
// Mounts fresh on open, so the rAF flip plays the scale/opacity intro.
function PeriodMenu({value,onChange,onClose}) {
  const [shown,setShown]=useState(false);
  useEffect(()=>{ const id=requestAnimationFrame(()=>setShown(true)); return ()=>cancelAnimationFrame(id); },[]);
  return (<>
    <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:90}}/>
    <div style={{position:"absolute",top:"calc(100% + 4px)",right:0,zIndex:91,background:C.white,border:`1px solid ${C.silver}`,borderRadius:10,boxShadow:"0 8px 24px rgba(0,0,0,0.14)",overflow:"hidden",minWidth:130,
                 opacity:shown?1:0,transform:shown?"scale(1)":"scale(0.95)",transformOrigin:"top right",transition:"opacity 150ms ease, transform 150ms ease"}}>
      {PERIOD_OPTIONS.map(o=>(
        <button key={o.key} onClick={()=>onChange(o.key)} style={{display:"block",width:"100%",textAlign:"left",padding:"10px 14px",border:"none",background:value===o.key?C.cherryL:C.white,color:value===o.key?C.cherry:C.dark,fontFamily:FONT,fontSize:13,cursor:"pointer",fontWeight:value===o.key?600:400,whiteSpace:"nowrap"}}>{o.label}</button>
      ))}
    </div>
  </>);
}

function PeriodPicker({value,onChange}) {
  const [open,setOpen]=useState(false);
  return (
    <div style={{position:"relative",flexShrink:0}}>
      <button onClick={()=>setOpen(o=>!o)} style={{display:"inline-flex",alignItems:"center",gap:4,padding:"9px 12px",background:"#EEF0F4",border:"none",borderRadius:8,fontFamily:FONT,fontSize:13,color:"#111318",cursor:"pointer",whiteSpace:"nowrap"}}>
        {periodLabel(value)}<span style={{fontSize:9,opacity:0.55}}>▾</span>
      </button>
      {open&&<PeriodMenu value={value} onChange={k=>{onChange(k);setOpen(false);}} onClose={()=>setOpen(false)}/>}
    </div>
  );
}

function OperaciiPage({receipts, cards, handleAdd, handleDelete, handleUpdate, activePeriod, setActivePeriod}) {
  const paymentOptions=[...cards.map(c=>c.name),"Наличные","Не указано"];
  const [search,setSearch]=useState("");
  const [sources,setSources]=useState([]);   // [] = «Все»
  const [cats,setCats]=useState([]);          // выбранные категории, [] = «Все»
  const [selCards,setSelCards]=useState([]);  // выбранные карты (по полю payment), [] = «Все»
  const [showFilters,setShowFilters]=useState(false);
  const defaultFrom="", defaultTo="";
  const [dateFrom,setDateFrom]=useState(defaultFrom);
  const [dateTo,setDateTo]=useState(defaultTo);
  const [limit,setLimit]=useState(30);
  const [showScan,setShowScan]=useState(false);
  const [showAdd,setShowAdd]=useState(false);
  const [detail,setDetail]=useState(null);
  const [form,setForm]=useState({org:"",amount:"",category:"Не указано",payment:"Не указано",date:todayISO(),fn:"",raw_data:null,source:"manual"});
  const [fnsStatus,setFnsStatus]=useState(null); // null | "loading" | "ok" | "partial"
  // In-flight FNS prefetch keyed by qrText, started the instant the modal
  // captures a QR (before the user taps "Загрузить чек"). By the time the
  // user confirms, the network round-trip is usually already done.
  const fnsPrefetchRef = useRef({qrText: null, promise: null});

  async function _fetchFns(qrText) {
    try {
      const res = await authFetch(`/api/fns/check`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({qr_raw: qrText}),
      });
      if (res.ok) return await res.json().catch(() => null);
    } catch { /* network failure or timeout — caller treats null as partial */ }
    return null;
  }

  // Called by the modal as soon as it captures a QR. Fire-and-forget — the
  // result is consumed later by handleCapture via the shared ref.
  function prefetchFns(qrText) {
    if (!qrText) return;
    if (fnsPrefetchRef.current.qrText === qrText && fnsPrefetchRef.current.promise) return;
    fnsPrefetchRef.current = {qrText, promise: _fetchFns(qrText)};
  }

  async function _suggestPayment(org) {
    if (!org) return null;
    try {
      const sres = await authFetch(`/api/receipts/suggest-payment?org=${encodeURIComponent(org)}`);
      if (sres.ok) { const sd = await sres.json(); return sd.payment || null; }
    } catch { /* ignored */ }
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
    setForm(p => ({...p, date: parsed.date||p.date, amount: parsed.amount||"",
                   org: "", category: "Не указано", fn: parsed.fn||"", raw_data: null, source: "qr_scan"}));
    setFnsStatus("loading");

    let d;
    if (fnsPrefetchRef.current.qrText === qrText && fnsPrefetchRef.current.promise) {
      d = await fnsPrefetchRef.current.promise;
    } else {
      d = await _fetchFns(qrText);
    }
    fnsPrefetchRef.current = {qrText: null, promise: null};

    if (!d || d.status === "partial" || !d.org) {
      setFnsStatus("partial");
      return "partial";
    }

    const raw = d.raw || {};
    const cash = Number(raw.cashTotalSum) || 0;
    const card = Number(raw.ecashTotalSum) || 0;
    const suggested = await _suggestPayment(d.org);
    const defaultCard = cards.find(c => c.is_default)?.name || null;
    let payment = "Не указано";
    if (cash > 0 && card === 0)      payment = "Наличные";
    else if (card > 0 && cash === 0) payment = (suggested && suggested !== "Наличные") ? suggested : (defaultCard || "Не указано");
    else if (suggested)              payment = suggested;

    setForm(p => ({...p,
      org: d.org || p.org,
      amount: d.total ? String(d.total) : p.amount,
      category: d.category || p.category,
      raw_data: d.raw || d,
      payment,
    }));
    setShowAdd(true);
    setFnsStatus("ok");
    setTimeout(() => setFnsStatus(s => s === "ok" ? null : s), 1500);
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
      const res = await authFetch(`/api/receipts/ocr/`, {method: "POST", body: fd}, 20000);
      if (res.ok) d = await res.json().catch(() => null);
    } catch { /* network or timeout */ }

    if (!d || !d.org || d.amount == null) {
      setFnsStatus("partial");
      return "partial";
    }

    const suggested = await _suggestPayment(d.org);
    const defaultCard = cards.find(c => c.is_default)?.name || null;
    let payment = "Не указано";
    if (d.payment_type === "cash")      payment = "Наличные";
    else if (d.payment_type === "card") payment = (suggested && suggested !== "Наличные") ? suggested : (defaultCard || "Не указано");
    else if (suggested)                 payment = suggested;

    setForm(p => ({...p,
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
    setTimeout(() => setFnsStatus(s => s === "ok" ? null : s), 1500);
    return "ok";
  }

  // qrText is optional — passed in from the modal's 'fnsError' screen so the user
  // doesn't have to retype date/amount/fn they already scanned.
  function handleManual(qrText) {
    setShowScan(false);
    if (qrText) {
      const parsed = parseQRString(qrText);
      // Came through the QR scanner (FNS just failed) — still a QR-sourced receipt.
      setForm(p => ({...p, date: parsed.date||p.date, amount: parsed.amount||"",
                     org: "", category: "Не указано", fn: parsed.fn||"", raw_data: null, source: "qr_scan"}));
      setFnsStatus("partial");  // show the yellow banner so the user knows why fields are empty
    } else {
      setForm(p => ({...p, source: "manual"}));
      setFnsStatus(null);
    }
    setShowAdd(true);
  }

  const customFilterActive=dateFrom!==defaultFrom||dateTo!==defaultTo;
  const inDate=r=>{
    if(customFilterActive) return (!dateFrom||r.date>=dateFrom) && (!dateTo||r.date<=dateTo);
    return inPeriod(r.date, activePeriod);
  };
  const filtered=receipts.filter(r=>{
    if(cats.length>0 && !cats.includes(r.category)) return false;
    if(selCards.length>0 && !selCards.includes(r.payment)) return false;
    if(sources.length>0 && !sources.includes(r.source)) return false;
    if(!search) return inDate(r);
    const q=search.toLowerCase();
    return (r.org.toLowerCase().includes(q)||shortOrg(r.org).toLowerCase().includes(q))&&inDate(r);
  });
  const groups=groupByMonth(filtered.slice(0,limit));
  const hiddenCount=filtered.length-limit;
  const filtersActive=customFilterActive||cats.length>0||selCards.length>0||sources.length>0;
  const resetFilters=()=>{ setDateFrom(defaultFrom); setDateTo(defaultTo); setCats([]); setSelCards([]); setSources([]); setSearch(""); };

  async function addR() {
    const payload={
      date:form.date, org:form.org, category:form.category,
      payment:form.payment, amount:Number(form.amount),
      source:form.source||"manual",
    };
    if(form.fn) payload.fn=form.fn;
    if(form.raw_data) payload.raw_data=form.raw_data;
    const res=await authFetch(`/api/receipts/`,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(payload)
    });
    if(res.status===409) {
      const body=await res.json().catch(()=>null);
      const existingId=body?.detail?.existing_id;
      setShowAdd(false);
      setForm({org:"",amount:"",category:"Не указано",payment:"Не указано",date:todayISO(),fn:"",raw_data:null,source:"manual"});
      setFnsStatus(null);
      if(existingId) {
        try {
          const er=await authFetch(`/api/receipts/${existingId}`);
          if(er.ok) {
            const ex=await er.json();
            handleAdd(ex);
            alert("Этот чек уже добавлен ранее — открываю существующий");
            setDetail({...ex,amount:Number(ex.amount)});
            return;
          }
        } catch {}
      }
      alert("Этот чек уже добавлен ранее");
      return;
    }
    if(!res.ok) {
      alert("Не удалось сохранить чек");
      return;
    }
    const created=await res.json();
    handleAdd(created);
    setShowAdd(false);
    setForm({org:"",amount:"",category:"Не указано",payment:"Не указано",date:todayISO(),fn:"",raw_data:null,source:"manual"});
    setFnsStatus(null);
  }

  return (
    <div style={{position:"relative"}}>
      {/* TODO: ФНС «Мои чеки онлайн» — включить когда будет готова интеграция
      <TabBar tabs={["Чеки","Онлайн чеки"]} active={tab} onSelect={setTab}/> */}
      <div style={{background:C.white,borderBottom:`1px solid ${C.silver}`,padding:"10px 16px",display:"flex",alignItems:"center",gap:8}}>
        <div style={{flex:1,minWidth:0,display:"flex",alignItems:"center",border:`1px solid #EEF0F4`,padding:"8px 12px",gap:8,background:"#F6F7F9",borderRadius:10}}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.grayL} strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Поиск..." style={{border:"none",outline:"none",flex:1,minWidth:0,fontSize:13,background:"none",fontFamily:FONT,color:C.dark}}/>
        </div>
        <PeriodPicker value={activePeriod} onChange={k=>{setActivePeriod(k);setDateFrom(defaultFrom);setDateTo(defaultTo);}}/>
        <FilterIcon active={filtersActive} onClick={()=>setShowFilters(true)}/>
      </div>
      <div style={{paddingBottom:80}}>
        {groups.map(([key,group])=>(
          <div key={key} style={{marginTop:6}}>
            <div style={{padding:"10px 16px 6px",display:"flex",alignItems:"center",gap:8}}>
              <div style={{width:3,height:12,background:"#D1D5DB",borderRadius:2}}/><span style={{fontSize:11,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:C.gray,fontFamily:FONT}}>{group.label}</span>
            </div>
            <div style={{margin:"0 12px",borderRadius:12,overflow:"hidden",background:C.white,border:`1px solid ${C.silver}`}}>
              {group.items.map((r,i)=>(
                <div key={r.id}>
                  <SwipeableReceiptCard receipt={r} onClick={()=>setDetail(r)} onDelete={()=>handleDelete(r.id)}/>
                  {i<group.items.length-1&&<div style={{height:1,background:C.silver,marginLeft:62}}/>}
                </div>
              ))}
            </div>
          </div>
        ))}
        {groups.length===0&&(
          <div style={{textAlign:"center",padding:"56px 24px",display:"flex",flexDirection:"column",alignItems:"center",gap:8}}>
            <ReceiptText size={48} color="#EEF0F4" strokeWidth={1.5}/>
            {(filtersActive||search)?(<>
              <div style={{fontSize:15,color:"#636B7D",fontFamily:FONT}}>Ничего не найдено</div>
              <div style={{fontSize:13,color:"#9CA3AF",fontFamily:FONT}}>Попробуйте изменить фильтры</div>
              <button onClick={resetFilters} style={{marginTop:4,background:"none",border:"none",color:C.cherry,fontFamily:FONT,fontSize:13,fontWeight:600,cursor:"pointer"}}>Сбросить фильтры</button>
            </>):(<>
              <div style={{fontSize:15,color:"#636B7D",fontFamily:FONT}}>Нет чеков за этот период</div>
              <div style={{fontSize:13,color:"#9CA3AF",fontFamily:FONT}}>Нажмите + чтобы добавить первый чек</div>
            </>)}
          </div>
        )}
        {hiddenCount>0&&(
          <div style={{padding:"14px 16px",textAlign:"center"}}>
            <button onClick={()=>setLimit(l=>l+30)} style={{padding:"10px 20px",border:`1px solid ${C.silver}`,background:C.white,color:C.cherry,fontFamily:FONT,fontSize:12,fontWeight:600,cursor:"pointer",borderRadius:10,letterSpacing:"0.03em"}}>
              Показать ещё {Math.min(30,hiddenCount)} · осталось {hiddenCount}
            </button>
          </div>
        )}
      </div>
      <button onClick={()=>setShowScan(true)} style={{position:"fixed",bottom:"calc(env(safe-area-inset-bottom) + 72px)",right:20,width:44,height:44,background:C.cherry,color:C.white,border:"none",fontSize:20,cursor:"pointer",boxShadow:`0 4px 12px rgba(164,22,26,0.35)`,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:"50%"}}>+</button>
      {showScan&&<ScanReceiptModal
        onClose={()=>setShowScan(false)}
        onCapture={handleCapture}
        onPrefetch={prefetchFns}
        onOcrFile={handleOcrFile}
        onManual={handleManual}/>}
      {showFilters&&<FiltersModal
        dateBuilder
        from={dateFrom} to={dateTo}
        categories={CATEGORIES}
        cards={cards}
        sources={sources}
        selectedCats={cats}
        selectedCards={selCards}
        onApply={r=>{ setDateFrom(r.from); setDateTo(r.to); setCats(r.cats); setSelCards(r.cards); setSources(r.sources); }}
        onReset={()=>{setDateFrom(defaultFrom);setDateTo(defaultTo);setCats([]);setSelCards([]);setSources([]);}}
        onClose={()=>setShowFilters(false)}/>}
      {detail&&<ReceiptDetailModal
        receipt={detail}
        paymentOptions={paymentOptions}
        onClose={()=>setDetail(null)}
        onDelete={()=>{handleDelete(detail.id);setDetail(null);}}
        onChangeCategory={async c=>{const upd=await handleUpdate(detail.id,{category:c});if(upd) setDetail(upd);}}
        onChangePayment={async p=>{const upd=await handleUpdate(detail.id,{payment:p});if(upd) setDetail(upd);}}
      />}
      {showAdd&&(
        <Modal title="Добавить чек" onClose={()=>{setShowAdd(false);setFnsStatus(null);}} footer={<Btn full onClick={addR} disabled={!form.org||!form.amount}>Добавить чек</Btn>}>
          <div style={{paddingTop:12}}>
            {fnsStatus==="loading"&&(
              <div style={{marginBottom:12,padding:"8px 12px",background:"#EEF0F4",border:`1px solid ${C.silver}`,borderRadius:6,fontFamily:FONT,fontSize:11,color:C.mid,display:"flex",alignItems:"center",gap:8}}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{flexShrink:0}}>
                  <circle cx="12" cy="12" r="9" strokeOpacity="0.25"/>
                  <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round">
                    <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>
                  </path>
                </svg>
                Загружаем данные из ФНС…
              </div>
            )}
            {fnsStatus==="ok"&&(
              <div style={{marginBottom:12,padding:"8px 12px",background:"#ECFDF5",border:"1px solid #A7F3D0",borderRadius:6,fontFamily:FONT,fontSize:11,color:"#047857"}}>
                Электронный чек загружен ✓
              </div>
            )}
            {fnsStatus==="partial"&&(
              <div style={{marginBottom:12,padding:"8px 12px",background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:6,fontFamily:FONT,fontSize:11,color:"#B45309"}}>
                Данные ФНС не загрузились. Заполните организацию вручную.
              </div>
            )}
            <RuleInput label="Организация" value={form.org} onChange={v=>setForm(p=>({...p,org:v}))} placeholder="Яндекс.Такси"/>
            <RuleInput label="Сумма (₽)" value={form.amount} onChange={v=>setForm(p=>({...p,amount:v}))} type="number" placeholder="0.00"/>
            <RuleInput label="Дата" value={form.date} onChange={v=>setForm(p=>({...p,date:v}))} type="date"/>
            <div style={{marginBottom:12}}><div style={{fontSize:9,letterSpacing:"0.15em",textTransform:"uppercase",color:C.gray,marginBottom:6,fontFamily:FONT}}>Категория</div><div style={{display:"flex",flexWrap:"wrap",gap:4}}>{CATEGORIES.map(c=><button key={c} onClick={()=>setForm(p=>({...p,category:c}))} style={{padding:"4px 10px",border:`1px solid ${form.category===c?C.cherry:C.silver}`,background:form.category===c?C.cherry:C.white,color:form.category===c?C.white:C.mid,fontFamily:FONT,fontSize:11,cursor:"pointer",borderRadius:6}}>{c}</button>)}</div></div>
            <div style={{marginBottom:8}}><div style={{fontSize:9,letterSpacing:"0.15em",textTransform:"uppercase",color:C.gray,marginBottom:6,fontFamily:FONT}}>Метод оплаты</div><div style={{display:"flex",flexWrap:"wrap",gap:4}}>{paymentOptions.map(m=><button key={m} onClick={()=>setForm(p=>({...p,payment:m}))} style={{padding:"4px 10px",border:`1px solid ${form.payment===m?C.cherry:C.silver}`,background:form.payment===m?C.cherryL:C.white,color:form.payment===m?C.cherry:C.mid,fontFamily:FONT,fontSize:11,cursor:"pointer",borderRadius:6}}>{m}</button>)}</div></div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function OtchetyPage({receipts}) {
  const [tab,setTab]=useState("Личные");
  const [reports,setReports]=useState([]);
  const [search,setSearch]=useState("");
  const [showC,setShowC]=useState(false);
  const [title,setTitle]=useState("");
  const [selected,setSelected]=useState([]);

  useEffect(()=>{
    authFetch(`/api/reports/`)
      .then(r=>r.json())
      .then(data=>setReports(Array.isArray(data)?data:[]))
      .catch(()=>{});
  },[]);

  const usedIds=reports.flatMap(r=>(r.receiptIds||[]));
  const free=receipts.filter(r=>!usedIds.includes(r.id));

  async function create() {
    const sel=free.filter(r=>selected.includes(r.id));
    const total=sel.reduce((s,r)=>s+Number(r.amount),0);
    const res=await authFetch(`/api/reports/`,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({title, total, receiptIds:selected})
    });
    const created=await res.json();
    setReports(prev=>[...prev,created]);
    setTitle("");setSelected([]);setShowC(false);
  }

  async function changeStatus(id, status) {
    const res=await authFetch(`/api/reports/${id}`,{
      method:"PATCH",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({status})
    });
    const updated=await res.json();
    setReports(prev=>prev.map(r=>r.id===id?updated:r));
  }

  const filtered=reports.filter(r=>r.status===tab&&(!search||r.title.toLowerCase().includes(search.toLowerCase())));
  const ST={"Личные":{bg:C.lightGray,color:C.mid,b:C.silver},"На проверке":{bg:"#FEF3C7",color:"#92400E",b:"#FCD34D"},"Одобрен":{bg:"#ECFDF5",color:"#065F46",b:"#6EE7B7"},"Отклонён":{bg:C.cherryL,color:C.cherry,b:C.cherryM}};
  return (
    <div>
      <TabBar tabs={["Личные","На проверке","Номинальные"]} active={tab} onSelect={setTab}/>
      <div style={{background:C.white,borderBottom:`1px solid ${C.silver}`,padding:"10px 16px",display:"flex",gap:8}}>
        <div style={{flex:1,display:"flex",alignItems:"center",border:`1px solid ${C.silver}`,padding:"7px 12px",gap:8,background:C.lightGray,borderRadius:6}}><span style={{color:C.grayL}}>⌕</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Поиск..." style={{border:"none",outline:"none",flex:1,fontSize:13,background:"none",fontFamily:FONT,color:C.dark}}/></div>
        <Btn small onClick={()=>setShowC(true)}>+ Новый</Btn>
      </div>
      {filtered.length===0?(
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"80px 20px",gap:16}}>
          <div style={{width:52,height:36,border:`1px solid ${C.silver}`,display:"flex",alignItems:"center",justifyContent:"center",color:C.grayL,fontSize:18}}>▤</div>
          {tab==="Личные"?<Btn onClick={()=>setShowC(true)}>Создать первый отчёт</Btn>:<span style={{color:C.grayL,fontFamily:FONT,fontSize:11,letterSpacing:"0.1em",textTransform:"uppercase"}}>Отчёты отсутствуют</span>}
        </div>
      ):(
        <div style={{paddingBottom:80}}>
          <div style={{background:C.lightGray,borderBottom:`1px solid ${C.silver}`,display:"grid",gridTemplateColumns:"1fr 100px 90px",padding:"7px 14px",gap:8}}>
            {["Наименование","Сумма","Статус"].map(h=><div key={h} style={{fontSize:9,letterSpacing:"0.15em",textTransform:"uppercase",color:C.gray,fontFamily:FONT}}>{h}</div>)}
          </div>
          {filtered.map(rep=>{const st=ST[rep.status]||ST["Личные"];return(
            <div key={rep.id} style={{background:C.white,borderBottom:`1px solid ${C.silver}`,borderLeft:`3px solid ${rep.status==="Личные"?C.silver:C.cherry}`}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 100px 90px",padding:"11px 14px",gap:8,alignItems:"center"}}>
                <div><div style={{fontFamily:FONT,fontSize:13,color:C.dark,fontWeight:700,marginBottom:2}}>{rep.title}</div><div style={{fontFamily:FONT,fontSize:10,color:C.gray}}>{fmtDate(rep.date)} · {(rep.receiptIds||[]).length} чеков</div></div>
                <div style={{fontFamily:FONT,fontSize:13,color:C.cherry,fontWeight:700,textAlign:"right"}}>{fmt(rep.total)}</div>
                <div style={{padding:"2px 6px",background:st.bg,border:`1px solid ${st.b}`,fontSize:9,fontFamily:FONT,color:st.color,textAlign:"center",textTransform:"uppercase",letterSpacing:"0.04em",borderRadius:4}}>{rep.status}</div>
              </div>
              {rep.status==="Личные"&&<div style={{padding:"0 14px 10px"}}><Btn small onClick={()=>changeStatus(rep.id,"На проверке")}>На проверку →</Btn></div>}
              {rep.status==="На проверке"&&<div style={{padding:"0 14px 10px",display:"flex",gap:6}}><Btn small onClick={()=>changeStatus(rep.id,"Одобрен")}>✓ Одобрить</Btn><Btn small outline onClick={()=>changeStatus(rep.id,"Отклонён")}>Отклонить</Btn></div>}
            </div>
          );})}
        </div>
      )}
      {showC&&(
        <Modal title="Новый отчёт" onClose={()=>setShowC(false)} footer={<Btn full onClick={create} disabled={!title||!selected.length}>Создать отчёт</Btn>}>
          <div style={{paddingTop:12}}>
            <RuleInput label="Название отчёта" value={title} onChange={setTitle} placeholder="Командировка, май 2026"/>
            <div style={{fontSize:9,letterSpacing:"0.15em",textTransform:"uppercase",color:C.gray,marginBottom:8,fontFamily:FONT}}>Выберите чеки · {selected.length} выбрано</div>
            {free.length===0&&<Block><span style={{fontFamily:FONT,fontSize:12,color:C.mid}}>Нет свободных чеков</span></Block>}
            {free.map(r=>{const sel=selected.includes(r.id);return(
              <div key={r.id} onClick={()=>setSelected(prev=>sel?prev.filter(x=>x!==r.id):[...prev,r.id])} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 10px",marginBottom:4,border:`1px solid ${sel?C.cherry:C.silver}`,background:sel?C.cherryL:C.white,cursor:"pointer"}}>
                <div style={{width:12,height:12,border:`1.5px solid ${sel?C.cherry:C.silver}`,background:sel?C.cherry:"transparent",display:"flex",alignItems:"center",justifyContent:"center",color:C.white,fontSize:10,flexShrink:0,borderRadius:3}}>{sel&&"✓"}</div>
                <div style={{flex:1}}><div style={{fontFamily:FONT,fontSize:13,color:C.dark,fontWeight:700}}>{shortOrg(r.org)}</div><div style={{fontFamily:FONT,fontSize:10,color:C.gray}}>{fmtDate(r.date)} · {r.category}</div></div>
                <span style={{fontFamily:FONT,fontSize:13,color:C.cherry,fontWeight:700}}>{fmt(r.amount)}</span>
              </div>
            );})}
            {selected.length>0&&<Block><div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontFamily:FONT,fontSize:11,color:C.gray}}>Итого:</span><span style={{fontFamily:FONT,fontSize:14,color:C.cherry,fontWeight:700}}>{fmt(free.filter(r=>selected.includes(r.id)).reduce((s,r)=>s+Number(r.amount),0))}</span></div></Block>}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── SETTINGS HELPERS & PARTS ─────────────────────────────
const ROLE_LABEL = Object.fromEntries(ROLES.map(r=>[r.id,r.label]));
const roleLabel = id => ROLE_LABEL[id] || "Сотрудник";
const userInitials = u => (`${(u.first_name||"")[0]||""}${(u.last_name||"")[0]||""}`).toUpperCase() || "?";

const SVC_ICON = {fns:"🧾", alfabank:"🏦", anthropic:"🤖"};
const SVC_STATUS = {
  active:         {label:"Активен",       bg:"#F0FDF4", fg:"#15803D"},
  in_progress:    {label:"В разработке",  bg:"#FFFBEB", fg:"#B45309"},
  not_connected:  {label:"Не подключено", bg:"#EEF0F4", fg:"#636B7D"},
  not_configured: {label:"Не настроен",   bg:"#EEF0F4", fg:"#636B7D"},
};

function ServiceCard({svc}) {
  const m = SVC_STATUS[svc.status] || SVC_STATUS.not_connected;
  return (
    <div style={{background:C.white,border:`1px solid ${C.silver}`,borderRadius:8,padding:"12px 14px",marginBottom:10,display:"flex",alignItems:"flex-start",gap:12}}>
      <div style={{width:36,height:36,borderRadius:8,background:C.lightGray,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{SVC_ICON[svc.key]||"⚙"}</div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:3}}>
          <span style={{fontFamily:FONT,fontSize:13,fontWeight:700,color:C.dark}}>{svc.name}</span>
          <span style={{fontFamily:FONT,fontSize:10,fontWeight:600,padding:"2px 8px",borderRadius:10,background:m.bg,color:m.fg,whiteSpace:"nowrap"}}>{m.label}</span>
        </div>
        <div style={{fontFamily:FONT,fontSize:11,color:C.gray,lineHeight:1.4}}>{svc.description}</div>
        {svc.key==="fns"&&(
          <div style={{marginTop:8}}>
            <button disabled title="Скоро" style={{padding:"6px 14px",border:`1px solid ${C.silver}`,background:C.lightGray,color:C.grayL,fontFamily:FONT,fontSize:12,borderRadius:8,cursor:"not-allowed"}}>Подключить</button>
          </div>
        )}
      </div>
    </div>
  );
}

// Swipe-left to reveal "Удалить" — mirrors SwipeableReceiptCard's pointer logic.
function SwipeableUserRow({user,onDelete,deletable=true}) {
  const [tx,setTx]=useState(0);
  const startX=useRef(0), startY=useRef(0), dragging=useRef(false), locked=useRef(null);
  const REVEAL=72;
  const u=user;
  const name=[u.last_name,u.first_name,u.patronymic].filter(Boolean).join(" ")||u.email||"Без имени";
  function down(e){if(!deletable)return;dragging.current=true;locked.current=null;startX.current=e.clientX;startY.current=e.clientY;e.currentTarget.setPointerCapture?.(e.pointerId);}
  function move(e){if(!dragging.current)return;const dx=e.clientX-startX.current,dy=e.clientY-startY.current;if(locked.current===null){if(Math.abs(dx)>6||Math.abs(dy)>6)locked.current=Math.abs(dx)>Math.abs(dy)?"x":"y";else return;}if(locked.current!=="x")return;const base=tx<0?-REVEAL:0;setTx(Math.min(0,Math.max(-REVEAL,base+dx)));}
  function up(){if(!dragging.current)return;dragging.current=false;if(locked.current==="x")setTx(tx<-REVEAL/2?-REVEAL:0);}
  return (
    <div style={{position:"relative",background:"#B91C1C",borderBottom:`1px solid ${C.silver}`,overflow:"hidden"}}>
      {deletable&&<div onClick={onDelete} style={{position:"absolute",top:0,right:0,bottom:0,width:REVEAL,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:"#fff",fontFamily:FONT,fontSize:12,fontWeight:600}}>Удалить</div>}
      <div onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        style={{background:C.white,padding:"11px 14px",display:"flex",alignItems:"center",gap:12,transform:`translateX(${tx}px)`,transition:dragging.current?"none":"transform 0.2s ease",userSelect:"none",touchAction:"pan-y",borderLeft:`3px solid ${u.is_active!==false?C.cherry:C.silver}`}}>
        <div style={{width:34,height:34,borderRadius:"50%",background:C.cherry,color:C.white,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:FONT,fontSize:11,fontWeight:700,flexShrink:0}}>{userInitials(u)}</div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontFamily:FONT,fontSize:13,color:C.dark,fontWeight:700,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{name}</div>
          <div style={{fontFamily:FONT,fontSize:11,color:C.gray}}>{roleLabel(u.role)} · {u.is_active!==false?"активен":"неактивен"}</div>
        </div>
      </div>
    </div>
  );
}

function AddEmployeeSheet({onClose,onAdd}) {
  const [f,setF]=useState({first_name:"",last_name:"",patronymic:"",email:"",role:"employee"});
  const [busy,setBusy]=useState(false);
  const ROLE_CHIPS=[["employee","Сотрудник"],["manager","Руководитель"],["accountant","Бухгалтер"]];
  const inp={width:"100%",padding:"10px 12px",border:`1px solid ${C.silver}`,borderRadius:8,fontSize:13,fontFamily:FONT,color:C.dark,background:C.white,boxSizing:"border-box"};
  const set=(k,v)=>setF(p=>({...p,[k]:v}));
  async function submit(){
    if(!f.first_name.trim()||busy)return;
    setBusy(true);
    await onAdd(f);
    setBusy(false);
    onClose();
  }
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(22,26,29,0.5)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:300}}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.white,width:"100%",maxWidth:480,borderRadius:"16px 16px 0 0",overflow:"hidden",display:"flex",flexDirection:"column",maxHeight:"88dvh",paddingBottom:"env(safe-area-inset-bottom)"}}>
        <div style={{padding:"14px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:`1px solid ${C.silver}`}}>
          <span style={{fontFamily:FONT,fontSize:14,fontWeight:600,color:C.dark}}>Новый сотрудник</span>
          <button onClick={onClose} style={{border:"none",background:"none",color:C.gray,cursor:"pointer",fontSize:20,padding:4,lineHeight:1}}>✕</button>
        </div>
        <div style={{overflow:"auto",padding:"16px",display:"flex",flexDirection:"column",gap:12}}>
          <input style={inp} placeholder="Имя" value={f.first_name} onChange={e=>set("first_name",e.target.value)}/>
          <input style={inp} placeholder="Фамилия" value={f.last_name} onChange={e=>set("last_name",e.target.value)}/>
          <input style={inp} placeholder="Отчество" value={f.patronymic} onChange={e=>set("patronymic",e.target.value)}/>
          <input style={inp} placeholder="Email" type="email" value={f.email} onChange={e=>set("email",e.target.value)}/>
          <div>
            <div style={{fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",color:C.gray,fontFamily:FONT,marginBottom:8}}>Роль</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {ROLE_CHIPS.map(([val,label])=>{
                const on=f.role===val;
                return <button key={val} onClick={()=>set("role",val)} style={{padding:"6px 12px",border:"none",borderRadius:8,cursor:"pointer",fontFamily:FONT,fontSize:12,fontWeight:on?600:500,background:on?C.cherry:"#EEF0F4",color:on?"#fff":"#636B7D"}}>{label}</button>;
              })}
            </div>
          </div>
        </div>
        <div style={{padding:"12px 16px",borderTop:`1px solid ${C.silver}`,background:C.lightGray}}>
          <Btn full onClick={submit} disabled={!f.first_name.trim()||busy}>Добавить сотрудника</Btn>
        </div>
      </div>
    </div>
  );
}

const ACC_FIELDS=[["Имя","first_name"],["Отчество","patronymic"],["Фамилия","last_name"],["Email","email"],["ИНН","inn"],["Регион","region"],["Табельный №","employee_id"]];

// Account tab. Mounted with key={me.id} so loading the current user resets the
// form via the useState initializer — no syncing effect needed.
function AccountTab({me, onSave}) {
  const [acc,setAcc]=useState({
    first_name:me.first_name||"", patronymic:me.patronymic||"", last_name:me.last_name||"",
    email:me.email||"", inn:me.inn||"", region:me.region||"", employee_id:me.employee_id||"",
  });
  const [roles,setRoles]=useState({admin:true,employee:true,manager:true,accountant:true});
  const [saved,setSaved]=useState(false);
  async function save(){
    const u=await onSave(acc);
    if(u){ setSaved(true); setTimeout(()=>setSaved(false),2000); }
  }
  return (
    <div style={{padding:"12px 16px 80px"}}>
      <SectionHead title="Личные данные"/>
      {ACC_FIELDS.map(([label,key],i)=>(
        <div key={key} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"3px 12px",borderBottom:`1px solid ${C.silver}`,background:i%2===0?C.white:C.lightGray}}>
          <span style={{fontSize:11,color:C.gray,fontFamily:FONT,minWidth:110,flexShrink:0}}>{label}</span>
          <input value={acc[key]} onChange={e=>setAcc(p=>({...p,[key]:e.target.value}))} placeholder="—"
            style={{flex:1,textAlign:"right",border:"none",background:"transparent",fontSize:13,color:C.dark,fontFamily:FONT,outline:"none",padding:"7px 0"}}/>
        </div>
      ))}
      <div style={{marginTop:14}}><Btn full onClick={save}>Сохранить</Btn></div>

      <SectionHead title="Права доступа"/>
      {ROLES.map(r=>(
        <div key={r.id} style={{background:C.white,border:`1px solid ${C.silver}`,marginBottom:6,borderLeft:roles[r.id]?`3px solid ${C.cherry}`:`3px solid ${C.silver}`,borderRadius:6}}>
          <div style={{padding:"11px 14px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
              <span style={{fontFamily:FONT,fontSize:13,color:roles[r.id]?C.dark:C.gray,fontWeight:700}}>{r.label}</span>
              <Toggle value={roles[r.id]} onChange={v=>setRoles(p=>({...p,[r.id]:v}))}/>
            </div>
            <div style={{fontFamily:FONT,fontSize:11,color:C.gray,lineHeight:1.5}}>{r.desc}</div>
          </div>
        </div>
      ))}
      <div style={{marginTop:20,paddingTop:16,borderTop:`1px solid ${C.silver}`}}>
        <button onClick={logout} style={{width:"100%",padding:"12px",background:C.white,border:`1px solid ${C.silver}`,borderRadius:10,fontFamily:FONT,fontSize:14,fontWeight:600,color:C.cherry,cursor:"pointer"}}>Выйти</button>
      </div>
      {saved&&<div style={{position:"fixed",left:"50%",bottom:90,transform:"translateX(-50%)",background:"#15803D",color:"#fff",padding:"10px 18px",borderRadius:10,fontFamily:FONT,fontSize:13,fontWeight:600,zIndex:400,boxShadow:"0 6px 16px rgba(0,0,0,0.2)"}}>Сохранено ✓</div>}
    </div>
  );
}

function InviteSheet({onClose}) {
  const [role,setRole]=useState("employee");
  const [hours,setHours]=useState(null);   // null = бессрочная (по умолчанию)
  const [maxUses,setMaxUses]=useState(1);
  const [created,setCreated]=useState(null);
  const [busy,setBusy]=useState(false);
  const [copied,setCopied]=useState(false);
  const ROLE_CHIPS=[["employee","Сотрудник"],["manager","Руководитель"],["accountant","Бухгалтер"]];
  const TTL_CHIPS=[[24,"1 день"],[168,"7 дней"],[720,"30 дней"],[null,"Бессрочная"]];
  const USE_CHIPS=[[1,"Одноразовая"],[999,"Многоразовая"]];
  const chip=on=>({padding:"6px 12px",border:"none",borderRadius:8,cursor:"pointer",fontFamily:FONT,fontSize:12,fontWeight:on?600:500,background:on?"#A4161A":"#EEF0F4",color:on?"#fff":"#636B7D"});
  const lbl={fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",color:C.gray,fontFamily:FONT,marginBottom:8};
  async function create(){
    if(busy)return; setBusy(true);
    try{
      const res=await authFetch("/api/invite/create",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({role,expires_hours:hours,max_uses:maxUses})});
      const d=await res.json().catch(()=>null);
      if(res.ok&&d&&d.invite_url) setCreated(d);
    }catch{ /* ignore */ }
    finally{ setBusy(false); }
  }
  async function copy(){ try{ await navigator.clipboard.writeText(created.invite_url); setCopied(true); setTimeout(()=>setCopied(false),2000); }catch{ /* ignore */ } }
  async function share(){ try{ if(navigator.share){ await navigator.share({title:"Приглашение в AOCG AI Офис",url:created.invite_url}); } else { copy(); } }catch{ /* cancelled */ } }
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.3)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:300}}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.white,width:"100%",maxWidth:480,borderRadius:"16px 16px 0 0",display:"flex",flexDirection:"column",maxHeight:"88dvh",paddingBottom:"env(safe-area-inset-bottom)"}}>
        <div style={{display:"flex",justifyContent:"center",padding:"8px 0 2px"}}><div style={{width:36,height:4,borderRadius:2,background:"#D5D7DD"}}/></div>
        <div style={{padding:"4px 16px 12px",borderBottom:`1px solid ${C.silver}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:15,fontFamily:FONT,color:C.dark,fontWeight:600}}>Ссылка-приглашение</span>
          <button onClick={onClose} style={{border:"none",background:"none",color:C.gray,fontSize:18,cursor:"pointer"}}>✕</button>
        </div>
        <div style={{padding:"16px",overflow:"auto"}}>
          {!created ? (
            <>
              <div style={lbl}>Роль</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:16}}>
                {ROLE_CHIPS.map(([v,l])=><button key={v} onClick={()=>setRole(v)} style={chip(role===v)}>{l}</button>)}
              </div>
              <div style={lbl}>Срок действия</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:16}}>
                {TTL_CHIPS.map(([v,l])=><button key={l} onClick={()=>setHours(v)} style={chip(hours===v)}>{l}</button>)}
              </div>
              <div style={lbl}>Использований</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:20}}>
                {USE_CHIPS.map(([v,l])=><button key={v} onClick={()=>setMaxUses(v)} style={chip(maxUses===v)}>{l}</button>)}
              </div>
              <Btn full onClick={create} disabled={busy}>{busy?"Создаём…":"Создать"}</Btn>
            </>
          ) : (
            <>
              <div style={{fontSize:13,color:C.gray,fontFamily:FONT,marginBottom:8}}>Ссылка готова — отправьте сотруднику:</div>
              <div style={{background:C.lightGray,border:`1px solid ${C.silver}`,borderRadius:10,padding:"10px 12px",fontSize:12,color:C.dark,fontFamily:"monospace",wordBreak:"break-all",marginBottom:14}}>{created.invite_url}</div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={copy} style={{flex:1,padding:"12px",background:C.white,border:`1px solid ${C.silver}`,borderRadius:10,fontFamily:FONT,fontSize:13,fontWeight:600,color:C.dark,cursor:"pointer"}}>{copied?"Скопировано ✓":"📋 Скопировать"}</button>
                <button onClick={share} style={{flex:1,padding:"12px",background:C.cherry,border:"none",borderRadius:10,fontFamily:FONT,fontSize:13,fontWeight:600,color:"#fff",cursor:"pointer"}}>↗ Поделиться</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function NastroykiPage({cards,onAddCard,onUpdateCard,onDeleteCard,onSetDefaultCard,users,onAddUser,onUpdateUser,onDeleteUser}) {
  const [tab,setTab]=useState("Аккаунт");
  const [newCard,setNewCard]=useState("");
  const [showAddEmp,setShowAddEmp]=useState(false);
  const [showInvite,setShowInvite]=useState(false);
  const [servicesList,setServicesList]=useState([]);
  const [invites,setInvites]=useState([]);
  const me = users.find(u=>u.id===1) || {};

  const loadInvites=()=>authFetch(`/api/invite/list`).then(r=>r.json()).then(d=>setInvites(Array.isArray(d)?d:[])).catch(()=>{});
  const delInvite=(token)=>authFetch(`/api/invite/${token}`,{method:"DELETE"}).then(()=>loadInvites()).catch(()=>{});

  useEffect(()=>{
    authFetch(`/api/services/`).then(r=>r.json()).then(d=>setServicesList(Array.isArray(d)?d:[])).catch(()=>{});
    loadInvites();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  return (
    <div>
      <TabBar tabs={["Аккаунт","Лицензии","Пользователи","Сервисы","Общие"]} active={tab} onSelect={setTab}/>
      {tab==="Аккаунт"&&<AccountTab key={me.id||"new"} me={me} onSave={p=>onUpdateUser(1,p)}/>}
      {tab==="Лицензии"&&(
        <div style={{padding:"60px 24px",textAlign:"center"}}>
          <div style={{fontFamily:FONT,fontSize:13,color:C.grayL}}>Управление лицензиями — скоро</div>
        </div>
      )}
      {tab==="Пользователи"&&(
        <div style={{padding:"12px 16px 80px"}}>
          <SectionHead title="Сотрудники"/>
          {users.map(u=>(
            <SwipeableUserRow key={u.id} user={u} deletable={u.id!==1} onDelete={()=>onDeleteUser(u.id)}/>
          ))}
          {users.length===0&&<div style={{fontSize:12,color:C.grayL,fontFamily:FONT,padding:"10px 0"}}>Пока нет сотрудников</div>}
          <div style={{marginTop:14}}><Btn full onClick={()=>setShowAddEmp(true)}>+ Добавить сотрудника</Btn></div>
          <div style={{marginTop:10}}><Btn full outline onClick={()=>setShowInvite(true)}>+ Создать ссылку-приглашение</Btn></div>
          {invites.length>0 && (
            <div style={{marginTop:18}}>
              <SectionHead title="Ссылки-приглашения"/>
              {invites.map(inv=>(
                <div key={inv.token} style={{display:"flex",alignItems:"center",gap:10,background:C.white,border:`1px solid ${C.silver}`,borderRadius:8,padding:"10px 12px",marginBottom:6}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,color:C.dark,fontFamily:FONT,fontWeight:600}}>{roleLabel(inv.role)}</div>
                    <div style={{fontSize:11,color:C.gray,fontFamily:FONT}}>{inv.expires_at?`до ${new Date(inv.expires_at).toLocaleDateString("ru-RU")}`:"Бессрочная"} · {inv.max_uses>1?"многоразовая":"одноразовая"}</div>
                  </div>
                  <button onClick={()=>delInvite(inv.token)} title="Удалить" style={{border:"none",background:"none",color:C.cherryM,fontSize:16,cursor:"pointer",flexShrink:0,padding:4}}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {tab==="Сервисы"&&(
        <div style={{padding:"12px 16px 80px"}}>
          <SectionHead title="Интеграции"/>
          {servicesList.map(s=><ServiceCard key={s.key} svc={s}/>)}
          {servicesList.length===0&&<div style={{fontSize:12,color:C.grayL,fontFamily:FONT,padding:"10px 0"}}>Загрузка…</div>}
        </div>
      )}
      {tab==="Общие"&&(
        <div style={{padding:"12px 16px 80px"}}>
          <SectionHead title="Категории расходов"/>
          {CATEGORIES.map((c,i)=><div key={c} style={{background:i%2===0?C.white:C.lightGray,padding:"9px 14px",borderBottom:`1px solid ${C.silver}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{fontFamily:FONT,fontSize:13,color:C.dark}}>{c}</span><span style={{color:C.cherryM,fontSize:11,cursor:"pointer"}}>✎</span></div>)}
          <div style={{marginTop:12}}><Btn>+ Добавить категорию</Btn></div>
          <SectionHead title="Мои карты"/>
          <div style={{fontSize:11,color:C.gray,fontFamily:FONT,marginBottom:8,lineHeight:1.5}}>При сканировании чека карта подставляется по истории трат в той же организации. Если истории нет — подставляется карта по умолчанию (отмечена ★).</div>
          {cards.map((c,i)=>(
            <div key={c.id} style={{background:i%2===0?C.white:C.lightGray,padding:"5px 14px",borderBottom:`1px solid ${C.silver}`,display:"flex",alignItems:"center",gap:10}}>
              <span onClick={()=>{if(!c.is_default)onSetDefaultCard(c.id);}} title={c.is_default?"Карта по умолчанию":"Сделать картой по умолчанию"}
                style={{fontSize:16,cursor:c.is_default?"default":"pointer",flexShrink:0,color:c.is_default?C.cherry:C.grayL,lineHeight:1}}>{c.is_default?"★":"☆"}</span>
              <input defaultValue={c.name} onBlur={e=>{const v=e.target.value.trim();if(v&&v!==c.name)onUpdateCard(c.id,v);else e.target.value=c.name;}}
                style={{flex:1,border:"none",background:"transparent",fontSize:13,fontFamily:FONT,color:C.dark,outline:"none",padding:"4px 0"}}/>
              <span onClick={()=>onDeleteCard(c.id)} style={{color:C.cherryM,fontSize:14,cursor:"pointer",flexShrink:0}}>✕</span>
            </div>
          ))}
          {cards.length===0&&<div style={{fontSize:12,color:C.grayL,fontFamily:FONT,padding:"8px 0"}}>Пока нет карт</div>}
          <div style={{display:"flex",gap:6,marginTop:12}}>
            <input value={newCard} onChange={e=>setNewCard(e.target.value)} placeholder="Например: Личная Сбер"
              onKeyDown={e=>{if(e.key==="Enter"&&newCard.trim()){onAddCard(newCard.trim());setNewCard("");}}}
              style={{flex:1,border:`1px solid ${C.silver}`,borderRadius:6,outline:"none",padding:"7px 10px",fontSize:13,fontFamily:FONT,color:C.dark,background:C.white,boxSizing:"border-box"}}/>
            <Btn small onClick={()=>{if(newCard.trim()){onAddCard(newCard.trim());setNewCard("");}}}>+ Добавить</Btn>
          </div>
          <div style={{marginTop:28,paddingTop:14,borderTop:`1px solid ${C.silver}`,fontSize:10,color:C.grayL,fontFamily:FONT,textAlign:"center",letterSpacing:"0.04em"}}>
            Сборка от {__BUILD_TIME__}
          </div>
        </div>
      )}
      {showAddEmp&&<AddEmployeeSheet onClose={()=>setShowAddEmp(false)} onAdd={onAddUser}/>}
      {showInvite&&<InviteSheet onClose={()=>{setShowInvite(false);loadInvites();}}/>}
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

function ConsentBottomSheet({title, text, onClose}) {
  return (
    <div onClick={onClose}
      style={{position:"fixed",inset:0,background:"rgba(22,26,29,0.5)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:300}}>
      <div onClick={e => e.stopPropagation()}
        style={{background:C.white,width:"100%",maxWidth:480,maxHeight:"80dvh",borderRadius:"16px 16px 0 0",overflow:"hidden",display:"flex",flexDirection:"column",paddingBottom:"env(safe-area-inset-bottom)"}}>
        <div style={{padding:"14px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:`1px solid ${C.silver}`}}>
          <span style={{fontFamily:FONT,fontSize:14,fontWeight:600,color:C.dark}}>{title}</span>
          <button onClick={onClose}
            style={{border:"none",background:"none",color:C.gray,cursor:"pointer",fontSize:20,padding:4,lineHeight:1}}>✕</button>
        </div>
        <div style={{overflow:"auto",padding:"16px 18px",fontFamily:FONT,fontSize:13,color:C.dark,lineHeight:1.55,whiteSpace:"pre-wrap"}}>
          {text}
        </div>
        <div style={{padding:"12px 16px",borderTop:`1px solid ${C.silver}`,background:C.lightGray}}>
          <button onClick={onClose}
            style={{width:"100%",padding:"12px",background:C.white,border:`1px solid ${C.silver}`,borderRadius:10,fontFamily:FONT,fontSize:13,color:C.dark,cursor:"pointer",fontWeight:600}}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}

function ConsentCheckbox({checked, onToggleCheck, onOpenSheet, label}) {
  // Two distinct hit-targets:
  //   - the box itself toggles the checkbox
  //   - the label opens the corresponding bottom-sheet
  // This matches the spec: "тап на текст открывает bottom-sheet". Checking
  // the box requires an explicit, separate action.
  return (
    <div style={{display:"flex",alignItems:"flex-start",gap:12,padding:"4px 0"}}>
      <button onClick={onToggleCheck} aria-pressed={checked} aria-label="Отметить"
        style={{flexShrink:0,width:22,height:22,marginTop:1,borderRadius:5,
                border:`1.5px solid ${checked?C.cherry:C.silver}`,
                background:checked?C.cherry:C.white,
                display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",
                transition:"all 120ms ease",padding:0}}>
        {checked && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        )}
      </button>
      <button onClick={onOpenSheet}
        style={{flex:1,textAlign:"left",background:"none",border:"none",padding:0,cursor:"pointer",
                fontFamily:FONT,fontSize:13,color:C.dark,lineHeight:1.45}}>
        {label}
      </button>
    </div>
  );
}

function ConsentScreen({onAccept}) {
  const [policyChecked, setPolicyChecked] = useState(false);
  const [dataChecked, setDataChecked] = useState(false);
  const [sheet, setSheet] = useState(null);   // null | "policy" | "consent"
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
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({user_id: "local_user", ip_address: null}),
      });
    } catch { /* network failure tolerated */ }
    try {
      localStorage.setItem("consent_given", "true");
      localStorage.setItem("consent_version", POLICY_VERSION);
      localStorage.setItem("consent_at", new Date().toISOString());
    } catch { /* private mode / storage disabled */ }
    onAccept();
  }

  return (
    <div style={{maxWidth:480,margin:"0 auto",minHeight:"100dvh",display:"flex",flexDirection:"column",background:C.light,fontFamily:FONT,
                 padding:"calc(env(safe-area-inset-top) + 48px) 24px calc(env(safe-area-inset-bottom) + 24px)"}}>
      {/* Logo */}
      <div style={{display:"flex",justifyContent:"center",marginBottom:24}}>
        <div style={{width:72,height:72,background:"#fff",border:"1px solid #E8E4E0",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center"}}>
          <svg width="60" height="14" viewBox="0 0 770 180" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M286.511 0C304.22 2.1117e-07 321.53 5.25113 336.254 15.0893C350.978 24.9276 362.454 38.911 369.231 55.2714C376.008 71.6317 377.781 89.6342 374.326 107.002C370.871 124.37 362.344 140.324 349.822 152.846C337.3 165.367 321.347 173.895 303.979 177.349C286.611 180.804 268.608 179.031 252.248 172.254C235.888 165.478 221.904 154.002 212.066 139.278C202.228 124.554 196.977 107.243 196.977 89.5349H230.233C230.233 100.666 233.534 111.546 239.718 120.801C245.902 130.056 254.691 137.269 264.975 141.529C275.258 145.788 286.574 146.903 297.491 144.731C308.408 142.56 318.435 137.2 326.306 129.329C334.177 121.459 339.537 111.431 341.708 100.514C343.88 89.5973 342.765 78.2817 338.506 67.9982C334.246 57.7147 327.033 48.9253 317.778 42.7414C308.523 36.5575 297.642 33.2569 286.511 33.2569V0Z" fill="#161A1D"/>
            <path d="M483.489 179.07C465.78 179.07 448.47 173.819 433.746 163.98C419.022 154.142 407.546 140.159 400.769 123.798C393.992 107.438 392.219 89.4357 395.674 72.0676C399.129 54.6995 407.656 38.7459 420.178 26.2243C432.7 13.7026 448.653 5.17523 466.021 1.7205C483.389 -1.73421 501.392 0.0388551 517.752 6.81554C534.112 13.5922 548.096 25.0681 557.934 39.7921C567.772 54.516 573.023 71.8266 573.023 89.535L539.767 89.535C539.767 78.4042 536.466 67.5235 530.282 58.2686C524.098 49.0137 515.309 41.8004 505.025 37.5409C494.742 33.2813 483.426 32.1668 472.509 34.3383C461.592 36.5098 451.565 41.8698 443.694 49.7404C435.823 57.611 430.463 67.6388 428.292 78.5557C426.12 89.4725 427.235 100.788 431.494 111.072C435.754 121.355 442.967 130.145 452.222 136.328C461.477 142.512 472.358 145.813 483.489 145.813L483.489 179.07Z" fill="#161A1D"/>
            <path d="M770 89.5349C770 107.243 764.749 124.554 754.911 139.278C745.072 154.002 731.089 165.478 714.729 172.254C698.368 179.031 680.366 180.804 662.998 177.349C645.63 173.895 629.676 165.367 617.154 152.846C604.633 140.324 596.105 124.37 592.651 107.002C589.196 89.6342 590.969 71.6317 597.746 55.2713C604.522 38.911 615.998 24.9276 630.722 15.0893C645.446 5.25112 662.757 -5.11009e-06 680.465 -3.91369e-06L680.465 33.2569C669.334 33.2569 658.454 36.5575 649.199 42.7414C639.944 48.9253 632.731 57.7147 628.471 67.9982C624.211 78.2817 623.097 89.5973 625.269 100.514C627.44 111.431 632.8 121.459 640.671 129.329C648.541 137.2 658.569 142.56 669.486 144.731C680.403 146.903 691.718 145.788 702.002 141.529C712.285 137.269 721.075 130.056 727.259 120.801C733.442 111.546 736.743 100.666 736.743 89.5349L770 89.5349Z" fill="#161A1D"/>
            <path d="M71.6279 0L0 179.07H35.814L89.5349 44.7674L143.256 179.07H179.07L107.442 0H71.6279Z" fill="#A4161A"/>
          </svg>
        </div>
      </div>

      <h1 style={{fontFamily:FONT,fontSize:22,fontWeight:700,color:C.dark,textAlign:"center",margin:"0 0 8px",lineHeight:1.25}}>
        Добро пожаловать в AOCG AI Офис
      </h1>
      <p style={{fontFamily:FONT,fontSize:14,color:C.gray,textAlign:"center",margin:"0 0 32px",lineHeight:1.45}}>
        Перед началом работы ознакомьтесь с документами
      </p>

      <div style={{display:"flex",flexDirection:"column",gap:14,marginBottom:32}}>
        <ConsentCheckbox
          checked={policyChecked}
          onToggleCheck={() => setPolicyChecked(v => !v)}
          onOpenSheet={() => setSheet("policy")}
          label={<>Я ознакомился и согласен с <span style={{color:C.cherry,textDecoration:"underline"}}>Политикой конфиденциальности</span></>}
        />
        <ConsentCheckbox
          checked={dataChecked}
          onToggleCheck={() => setDataChecked(v => !v)}
          onOpenSheet={() => setSheet("consent")}
          label={<>Я даю <span style={{color:C.cherry,textDecoration:"underline"}}>согласие на обработку моих персональных данных</span> в соответствии с 152-ФЗ</>}
        />
      </div>

      <div style={{marginTop:"auto"}}>
        <button onClick={handleAccept} disabled={!canSubmit}
          style={{width:"100%",padding:"14px",border:"none",borderRadius:12,
                  background: canSubmit ? C.cherry : C.lightGray,
                  color: canSubmit ? C.white : C.grayL,
                  fontFamily:FONT,fontSize:14,fontWeight:600,letterSpacing:"0.03em",
                  cursor: canSubmit ? "pointer" : "default",transition:"background 150ms"}}>
          {submitting ? "Сохраняем…" : "Продолжить"}
        </button>
      </div>

      {sheet === "policy"  && <ConsentBottomSheet title="Политика конфиденциальности" text={POLICY_TEXT}  onClose={() => setSheet(null)}/>}
      {sheet === "consent" && <ConsentBottomSheet title="Согласие на обработку ПДн" text={CONSENT_TEXT} onClose={() => setSheet(null)}/>}
    </div>
  );
}

// ─── AUTH SCREENS ───────────────────────────────────────────
function AocgLogo({width=140}) {
  return (
    <svg width={width} height={width*180/770} viewBox="0 0 770 180" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M286.511 0C304.22 2.1117e-07 321.53 5.25113 336.254 15.0893C350.978 24.9276 362.454 38.911 369.231 55.2714C376.008 71.6317 377.781 89.6342 374.326 107.002C370.871 124.37 362.344 140.324 349.822 152.846C337.3 165.367 321.347 173.895 303.979 177.349C286.611 180.804 268.608 179.031 252.248 172.254C235.888 165.478 221.904 154.002 212.066 139.278C202.228 124.554 196.977 107.243 196.977 89.5349H230.233C230.233 100.666 233.534 111.546 239.718 120.801C245.902 130.056 254.691 137.269 264.975 141.529C275.258 145.788 286.574 146.903 297.491 144.731C308.408 142.56 318.435 137.2 326.306 129.329C334.177 121.459 339.537 111.431 341.708 100.514C343.88 89.5973 342.765 78.2817 338.506 67.9982C334.246 57.7147 327.033 48.9253 317.778 42.7414C308.523 36.5575 297.642 33.2569 286.511 33.2569V0Z" fill="#161A1D"/>
      <path d="M483.489 179.07C465.78 179.07 448.47 173.819 433.746 163.98C419.022 154.142 407.546 140.159 400.769 123.798C393.992 107.438 392.219 89.4357 395.674 72.0676C399.129 54.6995 407.656 38.7459 420.178 26.2243C432.7 13.7026 448.653 5.17523 466.021 1.7205C483.389 -1.73421 501.392 0.0388551 517.752 6.81554C534.112 13.5922 548.096 25.0681 557.934 39.7921C567.772 54.516 573.023 71.8266 573.023 89.535L539.767 89.535C539.767 78.4042 536.466 67.5235 530.282 58.2686C524.098 49.0137 515.309 41.8004 505.025 37.5409C494.742 33.2813 483.426 32.1668 472.509 34.3383C461.592 36.5098 451.565 41.8698 443.694 49.7404C435.823 57.611 430.463 67.6388 428.292 78.5557C426.12 89.4725 427.235 100.788 431.494 111.072C435.754 121.355 442.967 130.145 452.222 136.328C461.477 142.512 472.358 145.813 483.489 145.813L483.489 179.07Z" fill="#161A1D"/>
      <path d="M770 89.5349C770 107.243 764.749 124.554 754.911 139.278C745.072 154.002 731.089 165.478 714.729 172.254C698.368 179.031 680.366 180.804 662.998 177.349C645.63 173.895 629.676 165.367 617.154 152.846C604.633 140.324 596.105 124.37 592.651 107.002C589.196 89.6342 590.969 71.6317 597.746 55.2713C604.522 38.911 615.998 24.9276 630.722 15.0893C645.446 5.25112 662.757 -5.11009e-06 680.465 -3.91369e-06L680.465 33.2569C669.334 33.2569 658.454 36.5575 649.199 42.7414C639.944 48.9253 632.731 57.7147 628.471 67.9982C624.211 78.2817 623.097 89.5973 625.269 100.514C627.44 111.431 632.8 121.459 640.671 129.329C648.541 137.2 658.569 142.56 669.486 144.731C680.403 146.903 691.718 145.788 702.002 141.529C712.285 137.269 721.075 130.056 727.259 120.801C733.442 111.546 736.743 100.666 736.743 89.5349L770 89.5349Z" fill="#161A1D"/>
      <path d="M71.6279 0L0 179.07H35.814L89.5349 44.7674L143.256 179.07H179.07L107.442 0H71.6279Z" fill="#A4161A"/>
    </svg>
  );
}

function AuthShell({children}) {
  return (
    <div style={{minHeight:"100dvh",background:C.white,display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center",padding:"32px 24px",boxSizing:"border-box",fontFamily:FONT}}>
      {children}
    </div>
  );
}

const A_INPUT = {width:"100%",padding:"13px 14px",border:`1px solid ${C.silver}`,borderRadius:10,fontSize:15,fontFamily:FONT,color:C.dark,background:C.white,boxSizing:"border-box",outline:"none"};

function LoginScreen({onAuthed, navigate}) {
  const [ident,setIdent]=useState("");
  const [password,setPassword]=useState("");
  const [showPw,setShowPw]=useState(false);
  const [err,setErr]=useState("");
  const [busy,setBusy]=useState(false);
  async function submit() {
    if(!ident.trim()||!password||busy) return;
    setBusy(true); setErr("");
    try {
      const res=await fetchWithTimeout(API+"/api/auth/login",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({phone_or_email:ident.trim(),password})},15000);
      const d=await res.json().catch(()=>({}));
      if(res.ok&&d.access_token){ onAuthed(d); return; }
      setErr(typeof d.detail==="string"?d.detail:"Неверный логин или пароль");
    } catch { setErr("Нет связи с сервером"); }
    finally { setBusy(false); }
  }
  const oauthSoon=()=>alert("OAuth будет добавлен после регистрации приложений у провайдеров");
  const forgotSoon=()=>alert("Восстановление пароля скоро будет доступно");
  return (
    <AuthShell>
      <div style={{width:"100%",maxWidth:360,display:"flex",flexDirection:"column",alignItems:"center"}}>
        <AocgLogo width={140}/>
        <h1 style={{fontSize:24,fontWeight:700,color:C.dark,fontFamily:FONT,margin:"22px 0 4px"}}>AI Офис</h1>
        <div style={{fontSize:13,color:"#636B7D",fontFamily:FONT,marginBottom:22,textAlign:"center"}}>Управление первичными документами</div>
        <div style={{display:"flex",gap:18,justifyContent:"center",marginBottom:18}}>
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6}}>
            <button onClick={oauthSoon} type="button" title="Google" style={{width:52,height:52,borderRadius:"50%",border:`1px solid ${C.silver}`,background:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:FONT,fontSize:22,fontWeight:700,color:"#4285F4"}}>G</button>
            <span style={{fontSize:10,color:"#636B7D",fontFamily:FONT}}>Google</span>
          </div>
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6}}>
            <button onClick={oauthSoon} type="button" title="Яндекс" style={{width:52,height:52,borderRadius:"50%",border:"none",background:"#FC3F1D",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:FONT,fontSize:24,fontWeight:700,color:"#fff"}}>Я</button>
            <span style={{fontSize:10,color:"#636B7D",fontFamily:FONT}}>Яндекс</span>
          </div>
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6}}>
            <button onClick={oauthSoon} type="button" title="Mail.ru" style={{width:52,height:52,borderRadius:"50%",border:"none",background:"#005FF9",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:FONT,fontSize:22,fontWeight:700,color:"#fff"}}>@</button>
            <span style={{fontSize:10,color:"#636B7D",fontFamily:FONT}}>Mail.ru</span>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10,width:"100%",marginBottom:18}}>
          <div style={{flex:1,height:1,background:C.silver}}/>
          <span style={{fontSize:12,color:"#9CA3AF",fontFamily:FONT}}>или</span>
          <div style={{flex:1,height:1,background:C.silver}}/>
        </div>
        <input value={ident} onChange={e=>setIdent(e.target.value)} placeholder="Телефон или Email" autoCapitalize="none" autoCorrect="off"
          style={{...A_INPUT,marginBottom:10}}/>
        <div style={{position:"relative",width:"100%",marginBottom:6}}>
          <input value={password} onChange={e=>setPassword(e.target.value)} type={showPw?"text":"password"} placeholder="Пароль"
            onKeyDown={e=>{if(e.key==="Enter")submit();}} style={{...A_INPUT,paddingRight:44}}/>
          <button onClick={()=>setShowPw(s=>!s)} type="button"
            style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",border:"none",background:"none",cursor:"pointer",color:"#636B7D",display:"flex",padding:6}}>
            {showPw?<EyeOff size={18}/>:<Eye size={18}/>}
          </button>
        </div>
        <div style={{width:"100%",textAlign:"right",marginBottom:6}}>
          <button onClick={forgotSoon} type="button" style={{background:"none",border:"none",color:"#636B7D",fontSize:13,cursor:"pointer",fontFamily:FONT,padding:0}}>Забыли пароль?</button>
        </div>
        {err&&<div style={{color:C.cherry,fontSize:13,fontFamily:FONT,width:"100%",marginBottom:4}}>{err}</div>}
        <button onClick={submit} disabled={busy}
          style={{width:"100%",marginTop:8,padding:"13px",background:C.cherry,color:"#fff",border:"none",borderRadius:10,fontFamily:FONT,fontSize:15,fontWeight:600,cursor:busy?"default":"pointer",opacity:busy?0.7:1}}>
          {busy?"Вход…":"Войти"}
        </button>
        <button onClick={()=>navigate("/register")} type="button"
          style={{marginTop:18,background:"none",border:"none",color:C.cherry,fontFamily:FONT,fontSize:14,cursor:"pointer"}}>
          Нет аккаунта? Зарегистрироваться
        </button>
      </div>
    </AuthShell>
  );
}

function VerifyEmailScreen({onAuthed, navigate}) {
  const token = new URLSearchParams(window.location.search).get("token");
  const [state,setState]=useState(token ? "loading" : "error"); // loading | error
  useEffect(()=>{
    if(!token) return;
    fetchWithTimeout(API+"/api/auth/verify-email?token="+encodeURIComponent(token),{},15000)
      .then(async r=>{ const d=await r.json().catch(()=>({})); if(r.ok&&d.access_token) onAuthed(d); else setState("error"); })
      .catch(()=>setState("error"));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  return (
    <AuthShell>
      <div style={{textAlign:"center",maxWidth:340}}>
        <AocgLogo width={120}/>
        <div style={{marginTop:22,fontSize:15,color:C.dark,fontFamily:FONT}}>
          {state==="loading"?"Подтверждаем email…":"Ссылка недействительна или истекла"}
        </div>
        {state==="error"&&<button onClick={()=>navigate("/login")} type="button"
          style={{marginTop:16,background:"none",border:"none",color:C.cherry,fontSize:14,cursor:"pointer",fontFamily:FONT}}>← Ко входу</button>}
      </div>
    </AuthShell>
  );
}

function CheckEmailScreen({email, navigate}) {
  return (
    <AuthShell>
      <div style={{maxWidth:340,display:"flex",flexDirection:"column",alignItems:"center",textAlign:"center"}}>
        <Mail size={48} color={C.cherry} strokeWidth={1.5}/>
        <h1 style={{fontSize:20,fontWeight:700,color:C.dark,fontFamily:FONT,margin:"16px 0 8px"}}>Проверьте почту</h1>
        <div style={{fontSize:14,color:"#636B7D",fontFamily:FONT,lineHeight:1.5}}>
          Мы отправили письмо на <b style={{color:C.dark}}>{email}</b>. Откройте ссылку в письме, чтобы подтвердить аккаунт.
        </div>
        <button onClick={()=>{window.location.href="mailto:";}} type="button"
          style={{marginTop:22,padding:"12px 24px",background:C.cherry,color:"#fff",border:"none",borderRadius:10,fontFamily:FONT,fontSize:14,fontWeight:600,cursor:"pointer"}}>Открыть почту</button>
        <button onClick={()=>navigate("/login")} type="button"
          style={{marginTop:16,background:"none",border:"none",color:C.cherry,fontSize:14,cursor:"pointer",fontFamily:FONT}}>← Ко входу</button>
      </div>
    </AuthShell>
  );
}

function RegisterScreen({onAuthed, navigate}) {
  const [step,setStep]=useState(1);            // 1: choose type, 2: form
  const [orgType,setOrgType]=useState(null);   // 'person' | 'company'
  const [f,setF]=useState({inn:"",org_name:"",phone:"",email:"",password:"",password2:"",first_name:"",last_name:""});
  const [showPw,setShowPw]=useState(false);
  const [err,setErr]=useState("");
  const [busy,setBusy]=useState(false);
  const [sent,setSent]=useState(false);
  const set=(k,v)=>setF(p=>({...p,[k]:v}));

  async function onInn(v) {
    set("inn", v);
    const digits=v.replace(/\D/g,"");
    if(digits.length===10||digits.length===12){
      try{
        const r=await fetchWithTimeout(API+"/api/egrul/"+digits,{},9000);
        const d=await r.json().catch(()=>null);
        if(d&&d.name) set("org_name", d.name);
      }catch{ /* manual entry */ }
    }
  }

  async function submit() {
    setErr("");
    if(!f.email.trim()||!f.password){ setErr("Заполните email и пароль"); return; }
    if(f.password.length<8){ setErr("Пароль не менее 8 символов"); return; }
    if(f.password!==f.password2){ setErr("Пароли не совпадают"); return; }
    if(!f.first_name.trim()){ setErr("Укажите имя"); return; }
    setBusy(true);
    try{
      const body={
        phone:f.phone.trim()||null, email:f.email.trim(), password:f.password,
        first_name:f.first_name.trim(), last_name:f.last_name.trim(), org_type:orgType,
        org_name:orgType==="company"?f.org_name.trim():null,
        inn:orgType==="company"?(f.inn.replace(/\D/g,"")||null):null,
      };
      const res=await fetchWithTimeout(API+"/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)},15000);
      const d=await res.json().catch(()=>({}));
      if(res.ok){
        if(d.access_token){ onAuthed(d); return; }   // auto-verified (no email provider)
        setSent(true); return;                         // verification email sent
      }
      setErr(typeof d.detail==="string"?d.detail:"Не удалось зарегистрироваться");
    }catch{ setErr("Нет связи с сервером"); }
    finally{ setBusy(false); }
  }

  if(sent) return <CheckEmailScreen email={f.email} navigate={navigate}/>;

  const typeBtn=(label,desc,t)=>(
    <button onClick={()=>{setOrgType(t);setStep(2);setErr("");}} type="button"
      style={{width:"100%",textAlign:"left",padding:"14px 16px",border:`1px solid ${orgType===t?C.cherry:C.silver}`,borderRadius:12,background:C.white,cursor:"pointer",marginBottom:10}}>
      <div style={{fontSize:15,fontWeight:600,color:C.dark,fontFamily:FONT}}>{label}</div>
      <div style={{fontSize:12,color:"#636B7D",fontFamily:FONT,marginTop:2}}>{desc}</div>
    </button>
  );

  return (
    <AuthShell>
      <div style={{width:"100%",maxWidth:380,display:"flex",flexDirection:"column",alignItems:"center"}}>
        <AocgLogo width={120}/>
        {step===1 ? (
          <div style={{width:"100%",marginTop:22}}>
            <div style={{fontSize:16,fontWeight:600,color:C.dark,fontFamily:FONT,textAlign:"center",marginBottom:18}}>Как будете использовать AI Офис?</div>
            {typeBtn("Для себя","ИП или физлицо","person")}
            {typeBtn("Для компании","ООО, АО — с ИНН","company")}
            <button onClick={()=>navigate("/login")} type="button"
              style={{marginTop:8,width:"100%",background:"none",border:"none",color:C.cherry,fontFamily:FONT,fontSize:14,cursor:"pointer"}}>Уже есть аккаунт? Войти</button>
          </div>
        ) : (
          <div style={{width:"100%",marginTop:18,display:"flex",flexDirection:"column",gap:10}}>
            <button onClick={()=>setStep(1)} type="button" style={{alignSelf:"flex-start",background:"none",border:"none",color:"#636B7D",fontFamily:FONT,fontSize:13,cursor:"pointer",padding:0,marginBottom:2}}>← Назад</button>
            {orgType==="company" && <>
              <input value={f.inn} onChange={e=>onInn(e.target.value)} inputMode="numeric" placeholder="ИНН компании" style={A_INPUT}/>
              <input value={f.org_name} onChange={e=>set("org_name",e.target.value)} placeholder="Название компании" style={A_INPUT}/>
            </>}
            <input value={f.first_name} onChange={e=>set("first_name",e.target.value)} placeholder="Имя" style={A_INPUT}/>
            <input value={f.last_name} onChange={e=>set("last_name",e.target.value)} placeholder="Фамилия" style={A_INPUT}/>
            <input value={f.phone} onChange={e=>set("phone",e.target.value)} inputMode="tel" placeholder="Телефон" style={A_INPUT}/>
            <input value={f.email} onChange={e=>set("email",e.target.value)} autoCapitalize="none" autoCorrect="off" placeholder="Email" style={A_INPUT}/>
            <div style={{position:"relative"}}>
              <input value={f.password} onChange={e=>set("password",e.target.value)} type={showPw?"text":"password"} placeholder="Пароль (от 8 символов)" style={{...A_INPUT,paddingRight:44}}/>
              <button onClick={()=>setShowPw(s=>!s)} type="button" style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",border:"none",background:"none",cursor:"pointer",color:"#636B7D",display:"flex",padding:6}}>{showPw?<EyeOff size={18}/>:<Eye size={18}/>}</button>
            </div>
            <input value={f.password2} onChange={e=>set("password2",e.target.value)} type={showPw?"text":"password"} placeholder="Повторите пароль" style={A_INPUT}/>
            {err&&<div style={{color:C.cherry,fontSize:13,fontFamily:FONT}}>{err}</div>}
            <button onClick={submit} disabled={busy}
              style={{marginTop:4,padding:"13px",background:C.cherry,color:"#fff",border:"none",borderRadius:10,fontFamily:FONT,fontSize:15,fontWeight:600,cursor:busy?"default":"pointer",opacity:busy?0.7:1}}>{busy?"Создаём…":"Зарегистрироваться"}</button>
          </div>
        )}
      </div>
    </AuthShell>
  );
}

function JoinScreen({token, onAuthed, navigate}) {
  const [info,setInfo]=useState(null);     // {is_valid, role, org_name}
  const [loading,setLoading]=useState(true);
  const [f,setF]=useState({first_name:"",last_name:"",phone:"",email:"",password:"",password2:""});
  const [showPw,setShowPw]=useState(false);
  const [err,setErr]=useState("");
  const [busy,setBusy]=useState(false);
  const [sent,setSent]=useState(false);
  const set=(k,v)=>setF(p=>({...p,[k]:v}));

  useEffect(()=>{
    fetchWithTimeout(API+"/api/invite/validate/"+encodeURIComponent(token),{},12000)
      .then(async r=>{ setInfo(await r.json().catch(()=>null)); })
      .catch(()=>setInfo(null))
      .finally(()=>setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  async function submit() {
    setErr("");
    if(!f.email.trim()||!f.password){ setErr("Заполните email и пароль"); return; }
    if(f.password.length<8){ setErr("Пароль не менее 8 символов"); return; }
    if(f.password!==f.password2){ setErr("Пароли не совпадают"); return; }
    if(!f.first_name.trim()){ setErr("Укажите имя"); return; }
    setBusy(true);
    try{
      const body={ token, phone:f.phone.trim()||null, email:f.email.trim(), password:f.password,
        first_name:f.first_name.trim(), last_name:f.last_name.trim() };
      const res=await fetchWithTimeout(API+"/api/auth/register-by-invite",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)},15000);
      const d=await res.json().catch(()=>({}));
      if(res.ok){ if(d.access_token){ onAuthed(d); return; } setSent(true); return; }
      setErr(typeof d.detail==="string"?d.detail:"Не удалось присоединиться");
    }catch{ setErr("Нет связи с сервером"); }
    finally{ setBusy(false); }
  }

  if(loading) return <AuthShell><div style={{textAlign:"center"}}><AocgLogo width={120}/><div style={{marginTop:22,fontSize:14,color:"#636B7D",fontFamily:FONT}}>Проверяем приглашение…</div></div></AuthShell>;
  if(!info||!info.is_valid) return (
    <AuthShell><div style={{textAlign:"center",maxWidth:340}}><AocgLogo width={120}/>
      <div style={{marginTop:22,fontSize:15,color:C.dark,fontFamily:FONT}}>Ссылка недействительна или истекла</div>
      <button onClick={()=>navigate("/login")} type="button" style={{marginTop:16,background:"none",border:"none",color:C.cherry,fontSize:14,cursor:"pointer",fontFamily:FONT}}>← Ко входу</button>
    </div></AuthShell>
  );
  if(sent) return <CheckEmailScreen email={f.email} navigate={navigate}/>;

  return (
    <AuthShell>
      <div style={{width:"100%",maxWidth:380,display:"flex",flexDirection:"column",alignItems:"center"}}>
        <AocgLogo width={120}/>
        <div style={{fontSize:16,fontWeight:600,color:C.dark,fontFamily:FONT,marginTop:18,textAlign:"center"}}>Присоединиться к «{info.org_name}»</div>
        <div style={{fontSize:13,color:"#636B7D",fontFamily:FONT,marginBottom:18}}>Роль: {roleLabel(info.role)}</div>
        <div style={{width:"100%",display:"flex",flexDirection:"column",gap:10}}>
          <input value={f.first_name} onChange={e=>set("first_name",e.target.value)} placeholder="Имя" style={A_INPUT}/>
          <input value={f.last_name} onChange={e=>set("last_name",e.target.value)} placeholder="Фамилия" style={A_INPUT}/>
          <input value={f.phone} onChange={e=>set("phone",e.target.value)} inputMode="tel" placeholder="Телефон" style={A_INPUT}/>
          <input value={f.email} onChange={e=>set("email",e.target.value)} autoCapitalize="none" autoCorrect="off" placeholder="Email" style={A_INPUT}/>
          <div style={{position:"relative"}}>
            <input value={f.password} onChange={e=>set("password",e.target.value)} type={showPw?"text":"password"} placeholder="Пароль (от 8 символов)" style={{...A_INPUT,paddingRight:44}}/>
            <button onClick={()=>setShowPw(s=>!s)} type="button" style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",border:"none",background:"none",cursor:"pointer",color:"#636B7D",display:"flex",padding:6}}>{showPw?<EyeOff size={18}/>:<Eye size={18}/>}</button>
          </div>
          <input value={f.password2} onChange={e=>set("password2",e.target.value)} type={showPw?"text":"password"} placeholder="Повторите пароль" style={A_INPUT}/>
          {err&&<div style={{color:C.cherry,fontSize:13,fontFamily:FONT}}>{err}</div>}
          <button onClick={submit} disabled={busy} style={{marginTop:4,padding:"13px",background:C.cherry,color:"#fff",border:"none",borderRadius:10,fontFamily:FONT,fontSize:15,fontWeight:600,cursor:busy?"default":"pointer",opacity:busy?0.7:1}}>{busy?"Присоединяем…":"Присоединиться"}</button>
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
    try { return localStorage.getItem("consent_given") === "true"; }
    catch { return false; }
  });
  const [page,setPage]=useState("svodka");
  const [receipts,setReceipts]=useState([]);
  const [cards,setCards]=useState([]);
  const [users,setUsers]=useState([]);
  const [activePeriod,setActivePeriod]=useState("month");

  // ─── Auth & lightweight routing ───
  const [authed, setAuthed] = useState(() => { try { return !!localStorage.getItem("access_token"); } catch { return false; } });
  const [route, setRoute] = useState(() => (typeof window !== "undefined" ? window.location.pathname : "/"));
  const navigate = (path) => { try { window.history.pushState({}, "", path); } catch { /* ignore */ } setRoute(path); };
  const onAuthed = (data) => { tokens.set(data); setAuthed(true); navigate("/"); };
  useEffect(() => {
    const onPop = () => setRoute(window.location.pathname);
    const onLogout = () => setAuthed(false);
    window.addEventListener("popstate", onPop);
    window.addEventListener("auth:logout", onLogout);
    return () => { window.removeEventListener("popstate", onPop); window.removeEventListener("auth:logout", onLogout); };
  }, []);

  // Don't fetch receipts/cards until the user has consented — keeps the
  // consent screen network-quiet, and re-runs the moment they accept.
  useEffect(()=>{
    if (!consentGiven || !authed) return;
    authFetch(`/api/receipts/`)
      .then(r=>r.json())
      .then(data=>setReceipts(Array.isArray(data)?data.map(r=>({...r,amount:Number(r.amount)})):[]))
      .catch(()=>{});
    authFetch(`/api/cards/`)
      .then(r=>r.json())
      .then(data=>setCards(Array.isArray(data)?data:[]))
      .catch(()=>{});
    authFetch(`/api/users/`)
      .then(r=>r.json())
      .then(data=>setUsers(Array.isArray(data)?data:[]))
      .catch(()=>{});
  },[consentGiven, authed]);

  async function addCard(name) {
    const res=await authFetch(`/api/cards/`,{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({name})
    });
    if(res.ok){const c=await res.json();setCards(prev=>[...prev,c]);}
  }

  async function updateCard(id,name) {
    const res=await authFetch(`/api/cards/${id}`,{
      method:"PATCH",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({name})
    });
    if(res.ok){const c=await res.json();setCards(prev=>prev.map(x=>x.id===id?c:x));}
  }

  async function deleteCard(id) {
    await authFetch(`/api/cards/${id}`,{method:"DELETE"});
    setCards(prev=>prev.filter(x=>x.id!==id));
  }

  async function setDefaultCard(id) {
    const res=await authFetch(`/api/cards/${id}/default`,{method:"PATCH"});
    if(res.ok) setCards(prev=>prev.map(x=>({...x,is_default:x.id===id})));
  }

  async function addUser(payload) {
    const res=await authFetch(`/api/users/`,{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify(payload)
    });
    if(res.ok){const u=await res.json();setUsers(prev=>[...prev,u]);return u;}
    return null;
  }

  async function updateUser(id, patch) {
    const res=await authFetch(`/api/users/${id}`,{
      method:"PATCH",headers:{"Content-Type":"application/json"},
      body:JSON.stringify(patch)
    });
    if(res.ok){const u=await res.json();setUsers(prev=>prev.map(x=>x.id===id?u:x));return u;}
    return null;
  }

  async function deleteUser(id) {
    await authFetch(`/api/users/${id}`,{method:"DELETE"});
    setUsers(prev=>prev.filter(x=>x.id!==id));
  }

  function handleAdd(created) {
    const norm={...created,amount:Number(created.amount)};
    setReceipts(prev=>prev.some(x=>x.id===norm.id)
      ? prev.map(x=>x.id===norm.id?norm:x)
      : [norm,...prev]);
  }

  async function handleDelete(id) {
    const res=await authFetch(`/api/receipts/${id}`,{method:"DELETE"});
    if(res.ok) setReceipts(prev=>prev.filter(x=>x.id!==id));
    else alert("Не удалось удалить чек");
  }

  async function handleUpdate(id, patch) {
    try {
      const res=await authFetch(`/api/receipts/${id}`,{
        method:"PATCH",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(patch)
      });
      if(!res.ok) return null;
      const updated=await res.json();
      const norm={...updated,amount:Number(updated.amount)};
      setReceipts(prev=>prev.map(r=>r.id===id?norm:r));
      return norm;
    } catch { return null; }
  }

  // First-launch gate — show the consent screen until the user accepts. The
  // 152-FZ POST + localStorage flip happens inside onAccept; once flipped,
  // the main UI mounts and the receipts/cards effect re-runs.
  // ─── Auth & route gate ───
  const isRegister = route === "/register";
  const isVerify   = route.startsWith("/verify-email");
  const isJoin     = route.startsWith("/join/");
  if (route === "/login" || (!authed && !isRegister && !isVerify && !isJoin)) {
    return <LoginScreen onAuthed={onAuthed} navigate={navigate}/>;
  }
  if (isRegister) return <RegisterScreen onAuthed={onAuthed} navigate={navigate}/>;
  if (isVerify)   return <VerifyEmailScreen onAuthed={onAuthed} navigate={navigate}/>;
  if (isJoin)     return <JoinScreen token={route.split("/join/")[1] || ""} onAuthed={onAuthed} navigate={navigate}/>;

  // Authed beyond this point.
  if (!consentGiven) {
    return <ConsentScreen onAccept={() => setConsentGiven(true)}/>;
  }

  const NAV=[{id:"svodka",Icon:LayoutDashboard,label:"Сводка"},{id:"operacii",Icon:Receipt,label:"Операции"},{id:"otchety",Icon:FileText,label:"Отчёты"},{id:"nastroyki",Icon:Settings,label:"Настройки"}];
  const PT={svodka:"Сводка",operacii:"Операции",otchety:"Отчёты",nastroyki:"Настройки"};
  return (
    <div style={{maxWidth:480,margin:"0 auto",height:"100dvh",display:"flex",flexDirection:"column",background:C.light,fontFamily:FONT,overflow:"hidden"}}>
      <div style={{background:C.white,borderBottom:`1px solid ${C.silver}`,flexShrink:0}}>
        <div style={{padding:"11px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:38,height:38,background:"#ffffff",border:"1.5px solid #D1D5DB",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <svg width="32" height="7.5" viewBox="0 0 770 180" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M286.511 0C304.22 2.1117e-07 321.53 5.25113 336.254 15.0893C350.978 24.9276 362.454 38.911 369.231 55.2714C376.008 71.6317 377.781 89.6342 374.326 107.002C370.871 124.37 362.344 140.324 349.822 152.846C337.3 165.367 321.347 173.895 303.979 177.349C286.611 180.804 268.608 179.031 252.248 172.254C235.888 165.478 221.904 154.002 212.066 139.278C202.228 124.554 196.977 107.243 196.977 89.5349H230.233C230.233 100.666 233.534 111.546 239.718 120.801C245.902 130.056 254.691 137.269 264.975 141.529C275.258 145.788 286.574 146.903 297.491 144.731C308.408 142.56 318.435 137.2 326.306 129.329C334.177 121.459 339.537 111.431 341.708 100.514C343.88 89.5973 342.765 78.2817 338.506 67.9982C334.246 57.7147 327.033 48.9253 317.778 42.7414C308.523 36.5575 297.642 33.2569 286.511 33.2569V0Z" fill="#161A1D"/>
                <path d="M483.489 179.07C465.78 179.07 448.47 173.819 433.746 163.98C419.022 154.142 407.546 140.159 400.769 123.798C393.992 107.438 392.219 89.4357 395.674 72.0676C399.129 54.6995 407.656 38.7459 420.178 26.2243C432.7 13.7026 448.653 5.17523 466.021 1.7205C483.389 -1.73421 501.392 0.0388551 517.752 6.81554C534.112 13.5922 548.096 25.0681 557.934 39.7921C567.772 54.516 573.023 71.8266 573.023 89.535L539.767 89.535C539.767 78.4042 536.466 67.5235 530.282 58.2686C524.098 49.0137 515.309 41.8004 505.025 37.5409C494.742 33.2813 483.426 32.1668 472.509 34.3383C461.592 36.5098 451.565 41.8698 443.694 49.7404C435.823 57.611 430.463 67.6388 428.292 78.5557C426.12 89.4725 427.235 100.788 431.494 111.072C435.754 121.355 442.967 130.145 452.222 136.328C461.477 142.512 472.358 145.813 483.489 145.813L483.489 179.07Z" fill="#161A1D"/>
                <path d="M770 89.5349C770 107.243 764.749 124.554 754.911 139.278C745.072 154.002 731.089 165.478 714.729 172.254C698.368 179.031 680.366 180.804 662.998 177.349C645.63 173.895 629.676 165.367 617.154 152.846C604.633 140.324 596.105 124.37 592.651 107.002C589.196 89.6342 590.969 71.6317 597.746 55.2713C604.522 38.911 615.998 24.9276 630.722 15.0893C645.446 5.25112 662.757 -5.11009e-06 680.465 -3.91369e-06L680.465 33.2569C669.334 33.2569 658.454 36.5575 649.199 42.7414C639.944 48.9253 632.731 57.7147 628.471 67.9982C624.211 78.2817 623.097 89.5973 625.269 100.514C627.44 111.431 632.8 121.459 640.671 129.329C648.541 137.2 658.569 142.56 669.486 144.731C680.403 146.903 691.718 145.788 702.002 141.529C712.285 137.269 721.075 130.056 727.259 120.801C733.442 111.546 736.743 100.666 736.743 89.5349L770 89.5349Z" fill="#161A1D"/>
                <path d="M71.6279 0L0 179.07H35.814L89.5349 44.7674L143.256 179.07H179.07L107.442 0H71.6279Z" fill="#A4161A"/>
              </svg>
            </div>
            <div>
              <div style={{lineHeight:1.1}}>
                <span style={{fontSize:15,fontFamily:FONT,color:C.dark,fontWeight:500}}>AI Офис</span>
                <span style={{fontSize:15,fontFamily:FONT,color:C.grayL,fontWeight:400}}> | </span>
                <span style={{fontSize:15,fontFamily:FONT,color:C.cherry,fontWeight:600}}>Чеки</span>
              </div>
            </div>
          </div>
          <div style={{width:30,height:30,background:C.lightGray,border:`1px solid ${C.silver}`,color:C.cherry,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:FONT,fontSize:10,fontWeight:700,borderRadius:"50%"}}>АШ</div>
        </div>
        <div style={{padding:"4px 16px 8px",display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:2,height:12,background:C.cherryM}}/><span style={{fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",color:C.mid,fontFamily:FONT}}>{PT[page]}</span><div style={{flex:1,height:"0.5px",background:C.silver}}/>
        </div>
      </div>
      <div style={{flex:1,overflow:"auto"}}>
        {page==="svodka"&&<SvodkaPage receipts={receipts} activePeriod={activePeriod} setActivePeriod={setActivePeriod} users={users} cards={cards}/>}
        {page==="operacii"&&<OperaciiPage receipts={receipts} cards={cards} handleAdd={handleAdd} handleDelete={handleDelete} handleUpdate={handleUpdate} activePeriod={activePeriod} setActivePeriod={setActivePeriod}/>}
        {page==="otchety"&&<OtchetyPage receipts={receipts}/>}
        {page==="nastroyki"&&<NastroykiPage cards={cards} onAddCard={addCard} onUpdateCard={updateCard} onDeleteCard={deleteCard} onSetDefaultCard={setDefaultCard} users={users} onAddUser={addUser} onUpdateUser={updateUser} onDeleteUser={deleteUser}/>}
      </div>
      <div style={{background:C.white,borderTop:`1px solid ${C.silver}`,display:"flex",flexShrink:0,paddingBottom:"env(safe-area-inset-bottom)"}}>
        {NAV.map(n=>{
          const Icon=n.Icon;
          const color=page===n.id?C.cherry:"#636B7D";
          return (
            <button key={n.id} onClick={()=>setPage(n.id)} style={{flex:1,padding:"9px 0",border:"none",background:"transparent",display:"flex",flexDirection:"column",alignItems:"center",gap:3,cursor:"pointer",transition:"opacity 100ms ease",borderRight:`1px solid ${C.silver}`}}>
              <Icon size={20} color={color} strokeWidth={2}/>
              <span style={{fontSize:10,letterSpacing:"0.1em",textTransform:"uppercase",fontFamily:FONT,color}}>{n.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
