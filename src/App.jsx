/* global __BUILD_TIME__ */
import { useState, useEffect, useRef, useCallback } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { Html5Qrcode, Html5QrcodeScannerState } from "html5-qrcode";

const API = import.meta.env.VITE_API_URL || "https://aocg-ai-office-production.up.railway.app";

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
      <div style={{width:20,height:20,background:C.lightGray,color:C.gray,fontSize:9,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:FONT,flexShrink:0}}>{num}</div>
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
        <span style={{fontSize:9,fontFamily:"'Courier New', Courier, monospace",color:"#9CA3AF"}}>{num}</span>
        <span style={{fontSize:11,fontWeight:600,letterSpacing:"0.12em",color:"#636B7D",fontFamily:FONT,textTransform:"uppercase"}}>{title}</span>
      </div>
      <div style={{padding:"4px 14px 8px"}}>{children}</div>
    </div>
  );
}

// Two-phase scanner:
//   1. `scanning`  — camera live, looking for a QR.
//      On hit → freeze frame (pause(true)) → vibrate(100) → 'captured'.
//   2. `captured`  — show local QR parse (org/amount/date) + [Загрузить чек] [Сканировать снова].
//   3. `loading`   — full-screen spinner while parent awaits FNS.
//   4. `fnsError`  — parent's onCapture returned 'partial' → offer manual entry / rescan.
//   5. `cameraError` — could not start camera at all → manual entry only.
// `onCapture(qrText) => Promise<'ok'|'partial'>` is the only network-touching prop;
// the modal owns its own UI transitions but never decides what counts as success.
function ScanReceiptModal({onClose, onCapture, onPrefetch, onOcrFile, onManual}) {
  const [phase, setPhase] = useState("scanning"); // scanning | captured | loading | fnsError | cameraError
  const [loadingMsg, setLoadingMsg] = useState("Загружаем данные из ФНС…");
  const [error, setError] = useState("");
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [qrText, setQrText] = useState("");
  const [qrParsed, setQrParsed] = useState(null);
  const scannerRef = useRef(null);
  const cameraOn = useRef(false);
  const fileRef = useRef(null);
  const ocrFileRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const capture = useCallback((text) => {
    try { if (navigator.vibrate) navigator.vibrate(100); } catch { /* ignored */ }
    setQrText(text);
    setQrParsed(parseQRString(text));
    setPhase("captured");
    // Kick off the FNS lookup in the background — the result is usually back
    // by the time the user taps "Загрузить чек", so the confirm tap feels
    // instant instead of staring at a spinner.
    if (onPrefetch) { try { onPrefetch(text); } catch { /* ignored */ } }
  }, [onPrefetch]);

  const startCamera = useCallback(() => {
    // Callers (mount, rescan, handleFile-fallback) reset `error` themselves
    // before invoking — avoid setError("") here so this stays callable from
    // useEffect without tripping the "synchronous setState in effect" rule.
    if (!scannerRef.current) scannerRef.current = new Html5Qrcode("qr-reader");
    const s = scannerRef.current;
    const config = {
      fps: 15,
      qrbox: { width: 280, height: 280 },
      aspectRatio: 1.0,
      disableFlip: false,
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    };
    s.start(
      { facingMode: "environment" },
      config,
      (text) => {
        if (!cameraOn.current) return;
        cameraOn.current = false;
        // Freeze the video frame; resume() later if user picks "Сканировать снова".
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
      setError("Нет доступа к камере");
      setPhase("cameraError");
    });
  }, [capture]);

  useEffect(() => {
    startCamera();
    return () => {
      const s = scannerRef.current;
      if (!s) return;
      cameraOn.current = false;
      // stop() works from SCANNING and PAUSED — pause-only doesn't release the camera.
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
    setError("");
    setQrText(""); setQrParsed(null);
    setPhase("scanning");
    const s = scannerRef.current;
    // Fast path: if we paused (camera still alive), just resume.
    try {
      if (s && s.getState && s.getState() === Html5QrcodeScannerState.PAUSED) {
        s.resume();
        cameraOn.current = true;
        return;
      }
    } catch { /* ignored */ }
    // Cold path: file-scan or full stop happened; reinitialize.
    if (s) { try { await s.stop().catch(() => {}); } catch { /* ignored */ } }
    scannerRef.current = null;
    cameraOn.current = false;
    startCamera();
  }

  async function confirm() {
    if (!qrText || !onCapture) return;
    setLoadingMsg("Загружаем данные из ФНС…");
    setPhase("loading");
    let result;
    try { result = await onCapture(qrText); }
    catch { result = "partial"; }
    if (!mountedRef.current) return;
    if (result === "ok") onClose();
    else setPhase("fnsError");
  }

  async function handleOcrPick(file) {
    if (!file || !onOcrFile) return;
    setLoadingMsg("Распознаём чек…");
    setPhase("loading");
    let result;
    try { result = await onOcrFile(file); }
    catch { result = "partial"; }
    if (!mountedRef.current) return;
    if (result === "ok") onClose();
    else setPhase("fnsError");
  }

  async function handleFile(file) {
    if (!file) return;
    setError("");
    try {
      if (cameraOn.current) { await scannerRef.current.stop().catch(() => {}); cameraOn.current = false; }
      const fileScanner = new Html5Qrcode("qr-file-reader");
      const result = await fileScanner.scanFile(file, false);
      capture(result);
    } catch {
      setError("QR-код не найден в изображении. Попробуйте сделать фото QR крупнее.");
      // Camera was stopped to scan the file — bring it back so the user can try again.
      scannerRef.current = null;
      startCamera();
    }
  }

  // ─── UI helpers ─────────────────────────────────────────────
  const showCameraView = phase === "scanning" || phase === "captured";

  const localChip = qrParsed && (
    <div style={{
      display:"flex",alignItems:"center",justifyContent:"center",gap:8,flexWrap:"wrap",
      padding:"10px 14px",background:"rgba(16,185,129,0.12)",border:"1px solid rgba(16,185,129,0.45)",
      borderRadius:8,fontFamily:FONT,fontSize:13,color:C.white,marginTop:14,maxWidth:320,
    }}>
      <span style={{fontWeight:600}}>Чек</span>
      {qrParsed.amount && <><span style={{opacity:0.6}}>·</span><span>{Number(qrParsed.amount).toLocaleString("ru-RU",{minimumFractionDigits:2})} ₽</span></>}
      {qrParsed.date && <><span style={{opacity:0.6}}>·</span><span>{fmtDate(qrParsed.date)}</span></>}
    </div>
  );

  return (
    <div style={{position:"fixed",inset:0,background:"#000",zIndex:200,display:"flex",flexDirection:"column"}}>
      {/* Keyframes for the captured-frame pulse — scoped via a unique name, no global CSS file. */}
      <style>{`@keyframes scanCapturedPulse{0%,100%{box-shadow:0 0 0 0 rgba(16,185,129,0.55)}50%{box-shadow:0 0 0 14px rgba(16,185,129,0)}}`}</style>

      <div style={{display:"flex",alignItems:"center",gap:12,padding:"14px 16px",background:"rgba(0,0,0,0.55)",flexShrink:0}}>
        <button onClick={onClose} style={{background:"none",border:"none",color:C.white,fontSize:22,cursor:"pointer",padding:0,lineHeight:1}}>←</button>
        <span style={{fontSize:15,fontFamily:FONT,color:C.white,fontWeight:600}}>Новый чек</span>
      </div>

      <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"0 16px"}}>
        <span style={{fontSize:14,color:C.white,fontFamily:FONT,marginBottom:20,opacity:0.85,minHeight:18}}>
          {phase==="captured" ? "QR распознан" : phase==="scanning" ? "Отсканируйте QR с чека" : ""}
        </span>

        {/* Camera viewport — always mounted (so #qr-reader exists) but visually hidden during loading/error overlays. */}
        <div style={{position:"relative",width:280,height:280,visibility:showCameraView?"visible":"hidden",
                     ...(showCameraView?{}:{position:"absolute",pointerEvents:"none"})}}>
          <div id="qr-reader" style={{width:280,height:280,borderRadius:12,overflow:"hidden"}}/>
          {/* Green animated frame on top of the frozen frame */}
          {phase==="captured" && (
            <div aria-hidden style={{
              position:"absolute",inset:0,borderRadius:12,pointerEvents:"none",
              border:"3px solid #10B981",animation:"scanCapturedPulse 1.5s ease-out infinite",
            }}/>
          )}
          {torchSupported && phase==="scanning" && (
            <button onClick={toggleTorch} aria-label="Фонарик" aria-pressed={torchOn}
              style={{position:"absolute",top:10,right:10,width:40,height:40,borderRadius:"50%",border:"none",
                background:torchOn?"rgba(255,221,87,0.95)":"rgba(0,0,0,0.55)",
                color:torchOn?"#161A1D":C.white,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",
                boxShadow:"0 2px 8px rgba(0,0,0,0.4)",transition:"background 150ms"}}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10"/></svg>
            </button>
          )}
        </div>
        <div id="qr-file-reader" style={{display:"none"}}/>

        {phase==="scanning" && (
          <div style={{marginTop:12,fontSize:12,color:"#9CA3AF",fontFamily:FONT}}>Наведите на QR-код чека</div>
        )}
        {phase==="captured" && localChip}

        {phase==="loading" && (
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:14,color:C.white,fontFamily:FONT,fontSize:14}}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="9" strokeOpacity="0.25"/>
              <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round">
                <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>
              </path>
            </svg>
            {loadingMsg}
          </div>
        )}

        {phase==="fnsError" && (
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6,color:C.white,fontFamily:FONT,textAlign:"center",maxWidth:320}}>
            <span style={{fontSize:15,fontWeight:600}}>Данные ФНС не загрузились</span>
            <span style={{fontSize:12,opacity:0.7}}>Распознать чек по фото, заполнить вручную или попробовать ещё раз</span>
          </div>
        )}

        {phase==="cameraError" && (
          <div style={{marginTop:16,padding:"10px 16px",background:"rgba(164,22,26,0.85)",borderRadius:8,maxWidth:320,textAlign:"center"}}>
            <span style={{fontSize:12,color:C.white,fontFamily:FONT}}>{error || "Нет доступа к камере"}</span>
          </div>
        )}
        {phase==="scanning" && error && (
          <div style={{marginTop:16,padding:"8px 16px",background:"rgba(164,22,26,0.85)",borderRadius:8}}>
            <span style={{fontSize:12,color:C.white,fontFamily:FONT}}>{error}</span>
          </div>
        )}
      </div>

      <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>handleFile(e.target.files[0])}/>
      <input ref={ocrFileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{display:"none"}} onChange={e=>handleOcrPick(e.target.files[0])}/>

      <div style={{padding:"16px 16px 32px",background:"rgba(0,0,0,0.55)",flexShrink:0,display:"flex",flexDirection:"column",gap:10}}>
        {phase==="scanning" && (<>
          <button onClick={()=>fileRef.current.click()}
            style={{width:"100%",padding:"13px 8px",background:C.white,border:"none",borderRadius:12,fontFamily:FONT,fontSize:13,color:C.dark,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8,boxShadow:"0 2px 12px rgba(0,0,0,0.3)"}}>
            <span style={{fontSize:20}}>🖼</span>Загрузить фото
          </button>
          <div style={{textAlign:"center"}}>
            <button onClick={()=>onManual()}
              style={{background:"none",border:"none",color:C.grayL,fontFamily:FONT,fontSize:13,cursor:"pointer",textDecoration:"underline"}}>
              Ввести вручную
            </button>
          </div>
        </>)}

        {phase==="captured" && (<>
          <button onClick={confirm}
            style={{width:"100%",padding:"13px 8px",background:C.cherry,border:"none",borderRadius:12,fontFamily:FONT,fontSize:13,fontWeight:600,color:C.white,cursor:"pointer",letterSpacing:"0.05em"}}>
            Загрузить чек
          </button>
          <button onClick={rescan}
            style={{width:"100%",padding:"12px 8px",background:"transparent",border:`1px solid rgba(255,255,255,0.45)`,borderRadius:12,fontFamily:FONT,fontSize:13,color:C.white,cursor:"pointer"}}>
            Сканировать снова
          </button>
        </>)}

        {phase==="loading" && (
          <button disabled
            style={{width:"100%",padding:"13px 8px",background:"rgba(255,255,255,0.15)",border:"none",borderRadius:12,fontFamily:FONT,fontSize:13,color:"rgba(255,255,255,0.6)",cursor:"default"}}>
            Загружаем…
          </button>
        )}

        {phase==="fnsError" && (<>
          {onOcrFile && (
            <button onClick={()=>ocrFileRef.current?.click()}
              style={{width:"100%",padding:"13px 8px",background:C.cherry,border:"none",borderRadius:12,fontFamily:FONT,fontSize:13,fontWeight:600,color:C.white,cursor:"pointer",letterSpacing:"0.05em",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
              <span style={{fontSize:16}}>📷</span>Распознать фото чека
            </button>
          )}
          <button onClick={()=>onManual(qrText)}
            style={{width:"100%",padding:"12px 8px",background:"transparent",border:`1px solid rgba(255,255,255,0.45)`,borderRadius:12,fontFamily:FONT,fontSize:13,color:C.white,cursor:"pointer"}}>
            Заполнить вручную
          </button>
          <button onClick={rescan}
            style={{width:"100%",padding:"10px 8px",background:"transparent",border:"none",fontFamily:FONT,fontSize:12,color:C.grayL,cursor:"pointer",textDecoration:"underline"}}>
            Сканировать снова
          </button>
        </>)}

        {phase==="cameraError" && (
          <button onClick={()=>onManual()}
            style={{width:"100%",padding:"13px 8px",background:C.white,border:"none",borderRadius:12,fontFamily:FONT,fontSize:13,color:C.dark,cursor:"pointer"}}>
            Ввести вручную
          </button>
        )}
      </div>
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

function SvodkaPage({receipts, activePeriod, setActivePeriod}) {
  const defaultFrom="", defaultTo="";
  const [dateFrom,setDateFrom]=useState(defaultFrom);
  const [dateTo,setDateTo]=useState(defaultTo);
  const [showFilters,setShowFilters]=useState(false);
  const customFilterActive=dateFrom!==defaultFrom||dateTo!==defaultTo;

  const filtered=receipts.filter(r=>{
    if(customFilterActive) return (!dateFrom||r.date>=dateFrom) && (!dateTo||r.date<=dateTo);
    return inPeriod(r.date, activePeriod);
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
              active={customFilterActive?null:periodLabel(activePeriod)}
              onChange={l=>{setActivePeriod(periodKey(l));setDateFrom(defaultFrom);setDateTo(defaultTo);}}/>
          </div>
          <div style={{flexShrink:0,display:"flex",alignItems:"center",gap:8}}>
            <FilterIcon active={customFilterActive} onClick={()=>setShowFilters(true)}/>
          </div>
        </div>
      </div>
      <div style={{padding:"12px 16px"}}>
        <div style={{background:C.white,border:`1px solid ${C.silver}`,padding:"12px 16px",marginBottom:10,borderLeft:"3px solid #A4161A",borderRadius:6}}>
          <div style={{fontSize:10,letterSpacing:"0.1em",textTransform:"uppercase",color:"#636B7D",marginBottom:6,fontFamily:FONT}}>Итого за период</div>
          <div style={{fontSize:30,fontWeight:700,color:"#111318",fontFamily:FONT,fontVariantNumeric:"tabular-nums",lineHeight:1.1,marginBottom:4}}>{fmt(total)}</div>
          <div style={{fontSize:12,color:"#636B7D",fontFamily:FONT}}>{subLine}</div>
        </div>
        <SectionCard title="Сотрудники" num="01">
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
        <Donut title="Организации" data={Object.entries(orgMap).map(([name,d])=>({name:shortOrg(name),...d}))} num="02"/>
        <Donut title="Методы оплаты" data={Object.entries(payMap).map(([name,d])=>({name,...d}))} num="03"/>
        <Donut title="Категории" data={Object.entries(catMap).map(([name,d])=>({name,...d}))} num="04"/>
      </div>
      {showFilters&&<FiltersModal from={dateFrom} to={dateTo} onApply={(f,t)=>{setDateFrom(f);setDateTo(t);}} onReset={()=>{setDateFrom(defaultFrom);setDateTo(defaultTo);}} onClose={()=>setShowFilters(false)}/>}
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
    <div style={{position:"relative",background:"#B91C1C",borderBottom:`1px solid ${C.silver}`,overflow:"hidden"}}>
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
          background:C.white,padding:"8px 16px",display:"flex",alignItems:"center",gap:12,
          transform:`translateX(${tx}px)`,transition:dragging.current?"none":"transform 0.2s ease",
          cursor:"pointer",userSelect:"none",touchAction:"pan-y"
        }}>
        <div style={{width:40,height:40,borderRadius:"50%",background:col.bg,color:col.fg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:FONT,fontSize:16,fontWeight:700,flexShrink:0}}>{orgInitial(r.org)}</div>
        <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",justifyContent:"center",gap:4}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{flex:1,minWidth:0,fontSize:14,fontFamily:FONT,color:C.dark,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{shortOrg(r.org)}</span>
            <span style={{fontSize:15,fontFamily:FONT,color:C.dark,fontWeight:700,flexShrink:0}}>{fmt(r.amount)}</span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:"#636B7D",fontFamily:FONT,minWidth:0}}>
            <span style={{display:"inline-block",padding:"2px 6px",borderRadius:4,background:col.bg,color:col.fg,fontSize:10,fontWeight:600,whiteSpace:"nowrap",flexShrink:0}}>{r.category||"Не указано"}</span>
            <span style={{flexShrink:0}}>·</span>
            <span style={{whiteSpace:"nowrap",flexShrink:0}}>{fmtDate(r.date)}</span>
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

function FiltersModal({from,to,onApply,onReset,onClose}) {
  const fromRef=useRef(null);
  const toRef=useRef(null);
  const inputStyle={width:"100%",padding:"10px 12px",border:`1px solid ${C.silver}`,borderRadius:8,fontSize:13,fontFamily:FONT,color:C.dark,background:C.white,boxSizing:"border-box"};
  const apply=(f,t)=>{onApply(f,t);onClose();};
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(22,26,29,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:120,padding:16}}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.white,width:"100%",maxWidth:420,borderRadius:16,overflow:"hidden"}}>
        <div style={{padding:"12px 16px",borderBottom:`1px solid ${C.silver}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontSize:14,fontFamily:FONT,color:C.dark,fontWeight:600}}>Фильтры</span>
          <button onClick={onClose} style={{border:"none",background:"none",color:C.gray,fontSize:18,cursor:"pointer"}}>✕</button>
        </div>
        <div style={{padding:"16px"}}>
          <div style={{fontSize:11,color:C.gray,fontFamily:FONT,marginBottom:6,letterSpacing:"0.05em"}}>Период</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div>
              <div style={{fontSize:10,color:C.gray,fontFamily:FONT,marginBottom:4}}>От</div>
              <input ref={fromRef} type="date" defaultValue={from||monthStartISO()} style={inputStyle}/>
            </div>
            <div>
              <div style={{fontSize:10,color:C.gray,fontFamily:FONT,marginBottom:4}}>До</div>
              <input ref={toRef} type="date" defaultValue={to||todayISO()} style={inputStyle}/>
            </div>
          </div>
        </div>
        <div style={{padding:"0 16px 16px",display:"flex",gap:8}}>
          <button onClick={()=>{onReset();onClose();}} title="Сбросить" style={{width:44,height:44,border:`1px solid ${C.silver}`,background:C.white,color:C.gray,cursor:"pointer",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
          </button>
          <button onClick={()=>apply(fromRef.current.value,toRef.current.value)} style={{flex:1,padding:"12px",background:C.cherry,border:"none",fontFamily:FONT,fontSize:13,color:C.white,cursor:"pointer",borderRadius:10,fontWeight:600,letterSpacing:"0.04em"}}>Применить</button>
        </div>
      </div>
    </div>
  );
}

function FilterIcon({active,onClick}) {
  const stroke=active?C.cherry:C.gray;
  return (
    <button onClick={onClick} style={{width:34,height:34,border:`1px solid ${active?C.cherry:C.silver}`,background:active?C.cherryL:C.white,cursor:"pointer",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round">
        <line x1="3" y1="6" x2="9" y2="6"/><circle cx="13" cy="6" r="2.2" fill={C.white}/><line x1="15.5" y1="6" x2="21" y2="6"/>
        <line x1="3" y1="12" x2="15" y2="12"/><circle cx="18" cy="12" r="2.2" fill={C.white}/><line x1="20.5" y1="12" x2="21" y2="12"/>
        <line x1="3" y1="18" x2="6" y2="18"/><circle cx="10" cy="18" r="2.2" fill={C.white}/><line x1="12.5" y1="18" x2="21" y2="18"/>
      </svg>
    </button>
  );
}

function OperaciiPage({receipts, cards, handleAdd, handleDelete, handleUpdate, activePeriod, setActivePeriod}) {
  const paymentOptions=[...cards.map(c=>c.name),"Наличные","Не указано"];
  const [tab,setTab]=useState("Чеки");
  const [search,setSearch]=useState("");
  const [showFilters,setShowFilters]=useState(false);
  const defaultFrom="", defaultTo="";
  const [dateFrom,setDateFrom]=useState(defaultFrom);
  const [dateTo,setDateTo]=useState(defaultTo);
  const [limit,setLimit]=useState(30);
  const [showScan,setShowScan]=useState(false);
  const [showAdd,setShowAdd]=useState(false);
  const [detail,setDetail]=useState(null);
  const [form,setForm]=useState({org:"",amount:"",category:"Не указано",payment:"Не указано",date:todayISO(),fn:"",raw_data:null});
  const [fnsStatus,setFnsStatus]=useState(null); // null | "loading" | "ok" | "partial"
  // In-flight FNS prefetch keyed by qrText, started the instant the modal
  // captures a QR (before the user taps "Загрузить чек"). By the time the
  // user confirms, the network round-trip is usually already done.
  const fnsPrefetchRef = useRef({qrText: null, promise: null});

  async function _fetchFns(qrText) {
    try {
      const res = await fetch(`${API}/api/fns/check`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({qr_raw: qrText}),
      });
      if (res.ok) return await res.json().catch(() => null);
    } catch { /* network failure — caller treats null as partial */ }
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
      const sres = await fetch(`${API}/api/receipts/suggest-payment?org=${encodeURIComponent(org)}`);
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
                   org: "", category: "Не указано", fn: parsed.fn||"", raw_data: null}));
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
    let payment = "Не указано";
    if (cash > 0 && card === 0)      payment = "Наличные";
    else if (card > 0 && cash === 0) payment = (suggested && suggested !== "Наличные") ? suggested : "Личная карта";
    else if (suggested)              payment = suggested;

    setForm(p => ({...p,
      org: d.org || p.org,
      amount: d.total ? String(d.total) : p.amount,
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
      const res = await fetch(`${API}/api/receipts/ocr/`, {method: "POST", body: fd});
      if (res.ok) d = await res.json().catch(() => null);
    } catch { /* network */ }

    if (!d || !d.org || d.amount == null) {
      setFnsStatus("partial");
      return "partial";
    }

    const suggested = await _suggestPayment(d.org);
    let payment = "Не указано";
    if (d.payment_type === "cash")      payment = "Наличные";
    else if (d.payment_type === "card") payment = (suggested && suggested !== "Наличные") ? suggested : "Личная карта";
    else if (suggested)                 payment = suggested;

    setForm(p => ({...p,
      org: d.org,
      amount: String(d.amount),
      date: d.date || p.date,
      category: d.category || "Не указано",
      fn: d.fn || p.fn,
      raw_data: d,
      payment,
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
      setForm(p => ({...p, date: parsed.date||p.date, amount: parsed.amount||"",
                     org: "", category: "Не указано", fn: parsed.fn||"", raw_data: null}));
      setFnsStatus("partial");  // show the yellow banner so the user knows why fields are empty
    } else {
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
    if(!search) return inDate(r);
    const q=search.toLowerCase();
    return (r.org.toLowerCase().includes(q)||shortOrg(r.org).toLowerCase().includes(q))&&inDate(r);
  });
  const groups=groupByMonth(filtered.slice(0,limit));
  const hiddenCount=filtered.length-limit;
  const filtersActive=customFilterActive;

  async function addR() {
    const payload={
      date:form.date, org:form.org, category:form.category,
      payment:form.payment, amount:Number(form.amount),
    };
    if(form.fn) payload.fn=form.fn;
    if(form.raw_data) payload.raw_data=form.raw_data;
    const res=await fetch(`${API}/api/receipts/`,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(payload)
    });
    if(res.status===409) {
      const body=await res.json().catch(()=>null);
      const existingId=body?.detail?.existing_id;
      setShowAdd(false);
      setForm({org:"",amount:"",category:"Не указано",payment:"Не указано",date:todayISO(),fn:"",raw_data:null});
      setFnsStatus(null);
      if(existingId) {
        try {
          const er=await fetch(`${API}/api/receipts/${existingId}`);
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
    setForm({org:"",amount:"",category:"Не указано",payment:"Не указано",date:todayISO(),fn:"",raw_data:null});
    setFnsStatus(null);
  }

  return (
    <div style={{position:"relative"}}>
      <TabBar tabs={["Чеки","Онлайн чеки"]} active={tab} onSelect={setTab}/>
      <div style={{background:C.white,borderBottom:`1px solid ${C.silver}`,padding:"10px 16px"}}>
        <div style={{display:"flex",alignItems:"center",border:`1px solid ${C.silver}`,padding:"8px 12px",gap:8,marginBottom:10,background:C.lightGray,borderRadius:10}}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.grayL} strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Поиск..." style={{border:"none",outline:"none",flex:1,fontSize:13,background:"none",fontFamily:FONT,color:C.dark}}/>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <div style={{flex:1,minWidth:0}}>
            <SegmentedControl
              segments={PERIOD_OPTIONS.map(o=>o.label)}
              active={customFilterActive?null:periodLabel(activePeriod)}
              onChange={l=>{setActivePeriod(periodKey(l));setDateFrom(defaultFrom);setDateTo(defaultTo);}}/>
          </div>
          <div style={{flexShrink:0,display:"flex",alignItems:"center",gap:8}}>
            <FilterIcon active={filtersActive} onClick={()=>setShowFilters(true)}/>
          </div>
        </div>
      </div>
      <div style={{paddingBottom:80}}>
        {groups.map(([key,group])=>(
          <div key={key}>
            <div style={{padding:"6px 16px",background:C.lightGray,borderBottom:`1px solid ${C.silver}`,borderTop:`1px solid ${C.silver}`,display:"flex",alignItems:"center",gap:8}}>
              <div style={{width:2,height:10,background:C.cherryM}}/><span style={{fontSize:9,letterSpacing:"0.18em",textTransform:"uppercase",color:C.gray,fontFamily:FONT}}>{group.label}</span>
            </div>
            {group.items.map(r=>(
              <SwipeableReceiptCard key={r.id} receipt={r} onClick={()=>setDetail(r)} onDelete={()=>handleDelete(r.id)}/>
            ))}
          </div>
        ))}
        {groups.length===0&&<div style={{textAlign:"center",padding:"60px 20px"}}><div style={{color:C.grayL,fontFamily:FONT,fontSize:11,letterSpacing:"0.1em",textTransform:"uppercase"}}>Нет операций</div></div>}
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
      {showFilters&&<FiltersModal from={dateFrom} to={dateTo} onApply={(f,t)=>{setDateFrom(f);setDateTo(t);}} onReset={()=>{setDateFrom(defaultFrom);setDateTo(defaultTo);}} onClose={()=>setShowFilters(false)}/>}
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
    fetch(`${API}/api/reports/`)
      .then(r=>r.json())
      .then(data=>setReports(Array.isArray(data)?data:[]))
      .catch(()=>{});
  },[]);

  const usedIds=reports.flatMap(r=>(r.receiptIds||[]));
  const free=receipts.filter(r=>!usedIds.includes(r.id));

  async function create() {
    const sel=free.filter(r=>selected.includes(r.id));
    const total=sel.reduce((s,r)=>s+Number(r.amount),0);
    const res=await fetch(`${API}/api/reports/`,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({title, total, receiptIds:selected})
    });
    const created=await res.json();
    setReports(prev=>[...prev,created]);
    setTitle("");setSelected([]);setShowC(false);
  }

  async function changeStatus(id, status) {
    const res=await fetch(`${API}/api/reports/${id}`,{
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

function NastroykiPage({cards,onAddCard,onUpdateCard,onDeleteCard}) {
  const [tab,setTab]=useState("Аккаунт");
  const [roles,setRoles]=useState({admin:true,employee:true,manager:true,accountant:true});
  const [newCard,setNewCard]=useState("");
  return (
    <div>
      <TabBar tabs={["Аккаунт","Лицензии","Пользователи","Сервисы","Общие"]} active={tab} onSelect={setTab}/>
      {tab==="Аккаунт"&&(
        <div style={{padding:"12px 16px 80px"}}>
          <SectionHead num="01" title="Личные данные"/>
          {[["Имя","Алексей"],["Отчество","Иванович"],["Фамилия","Шукалович"],["Дата рождения","01.09.1980"],["Email","a.slovich@gmail.com"],["ИНН","7839112580"],["Регион","Россия"],["Табельный №","—"]].map(([k,v],i)=>(
            <div key={k} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 12px",borderBottom:`1px solid ${C.silver}`,background:i%2===0?C.white:C.lightGray}}>
              <span style={{fontSize:11,color:C.gray,fontFamily:FONT,minWidth:120}}>{k}</span>
              <span style={{fontSize:13,color:C.dark,fontFamily:FONT}}>{v}</span>
            </div>
          ))}
          <SectionHead num="02" title="Права доступа"/>
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
          <div style={{marginTop:14}}><Btn>Сохранить изменения</Btn></div>
        </div>
      )}
      {tab==="Лицензии"&&<div style={{padding:"12px 16px"}}><Block><div style={{display:"flex",alignItems:"center",gap:10}}><div style={{width:24,height:24,background:C.cherry,display:"flex",alignItems:"center",justifyContent:"center",color:C.white,fontSize:12}}>✕</div><div><div style={{fontFamily:FONT,fontSize:13,color:C.dark,fontWeight:700}}>Ваша лицензия истекла</div><div style={{fontFamily:FONT,fontSize:11,color:C.gray}}>Необходимо продление</div></div></div></Block><Btn>Продлить лицензию</Btn></div>}
      {tab==="Пользователи"&&<div style={{padding:"12px 16px"}}><SectionHead num="01" title="Сотрудники"/><div style={{background:C.white,borderBottom:`1px solid ${C.silver}`,padding:"11px 14px",display:"flex",alignItems:"center",gap:12,borderLeft:`3px solid ${C.cherry}`}}><div style={{width:34,height:34,background:C.cherry,color:C.white,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:FONT,fontSize:11,fontWeight:700,borderRadius:6}}>АШ</div><div><div style={{fontFamily:FONT,fontSize:13,color:C.dark,fontWeight:700}}>Алексей Шукалович</div><div style={{fontFamily:FONT,fontSize:11,color:C.gray}}>Директор · a.slovich@gmail.com</div></div></div></div>}
      {tab==="Сервисы"&&(
        <div style={{padding:"12px 16px 80px"}}>
          <SectionHead num="01" title="Мои чеки онлайн"/>
          <div style={{background:C.white,border:`1px solid ${C.silver}`,marginBottom:14}}>
            <div style={{background:C.lightGray,borderBottom:`1px solid ${C.silver}`,padding:"8px 14px",display:"flex",alignItems:"center",gap:8}}><div style={{width:3,height:14,background:C.silver}}/><span style={{fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",color:C.mid,fontFamily:FONT}}>МОИ ЧЕКИ ОНЛАЙН</span></div>
            <div style={{padding:"12px 14px"}}><div style={{fontSize:9,letterSpacing:"0.15em",textTransform:"uppercase",color:C.gray,marginBottom:6,fontFamily:FONT}}>Привязанные номера</div><div style={{display:"flex",justifyContent:"space-between",padding:"8px 10px",background:C.lightGray,border:`1px solid ${C.silver}`,marginBottom:10}}><span style={{fontSize:11,color:C.gray,fontFamily:FONT}}>Телефон</span><span style={{fontSize:13,color:C.dark,fontFamily:FONT}}>+7 921 868 44 41</span></div><Btn outline small>Добавить номер</Btn></div>
          </div>
          <SectionHead num="02" title="Интеграция с 1С"/>
          <div style={{background:C.white,border:`1px solid ${C.silver}`}}>
            <div style={{background:C.lightGray,borderBottom:`1px solid ${C.silver}`,padding:"8px 14px",display:"flex",alignItems:"center",gap:8}}><div style={{width:3,height:14,background:C.cherry}}/><span style={{fontWeight:900,fontSize:12,fontFamily:FONT,color:C.cherry}}>1С</span><span style={{fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",color:C.mid,fontFamily:FONT}}>ИНТЕГРАЦИЯ</span></div>
            <div style={{padding:"12px 14px"}}><div style={{fontSize:9,letterSpacing:"0.15em",textTransform:"uppercase",color:C.gray,marginBottom:6,fontFamily:FONT}}>API-ключ</div><Block><span style={{fontSize:11,color:C.mid,fontFamily:"Courier, monospace",wordBreak:"break-all"}}>93f9609eb68e15ecabf4efdccbad9b0d</span></Block><Btn outline small>Копировать ⎘</Btn></div>
          </div>
        </div>
      )}
      {tab==="Общие"&&(
        <div style={{padding:"12px 16px 80px"}}>
          <SectionHead num="01" title="Категории расходов"/>
          {CATEGORIES.map((c,i)=><div key={c} style={{background:i%2===0?C.white:C.lightGray,padding:"9px 14px",borderBottom:`1px solid ${C.silver}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{fontFamily:FONT,fontSize:13,color:C.dark}}>{c}</span><span style={{color:C.cherryM,fontSize:11,cursor:"pointer"}}>✎</span></div>)}
          <div style={{marginTop:12}}><Btn>+ Добавить категорию</Btn></div>
          <SectionHead num="02" title="Мои карты"/>
          <div style={{fontSize:11,color:C.gray,fontFamily:FONT,marginBottom:8,lineHeight:1.5}}>Карты подставляются автоматически при сканировании чека — по истории трат в той же организации.</div>
          {cards.map((c,i)=>(
            <div key={c.id} style={{background:i%2===0?C.white:C.lightGray,padding:"5px 14px",borderBottom:`1px solid ${C.silver}`,display:"flex",alignItems:"center",gap:8}}>
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
    </div>
  );
}

export default function App() {
  const [page,setPage]=useState("svodka");
  const [receipts,setReceipts]=useState([]);
  const [cards,setCards]=useState([]);
  const [activePeriod,setActivePeriod]=useState("month");

  useEffect(()=>{
    fetch(`${API}/api/receipts/`)
      .then(r=>r.json())
      .then(data=>setReceipts(Array.isArray(data)?data.map(r=>({...r,amount:Number(r.amount)})):[]))
      .catch(()=>{});
    fetch(`${API}/api/cards/`)
      .then(r=>r.json())
      .then(data=>setCards(Array.isArray(data)?data:[]))
      .catch(()=>{});
  },[]);

  async function addCard(name) {
    const res=await fetch(`${API}/api/cards/`,{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({name})
    });
    if(res.ok){const c=await res.json();setCards(prev=>[...prev,c]);}
  }

  async function updateCard(id,name) {
    const res=await fetch(`${API}/api/cards/${id}`,{
      method:"PATCH",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({name})
    });
    if(res.ok){const c=await res.json();setCards(prev=>prev.map(x=>x.id===id?c:x));}
  }

  async function deleteCard(id) {
    await fetch(`${API}/api/cards/${id}`,{method:"DELETE"});
    setCards(prev=>prev.filter(x=>x.id!==id));
  }

  function handleAdd(created) {
    const norm={...created,amount:Number(created.amount)};
    setReceipts(prev=>prev.some(x=>x.id===norm.id)
      ? prev.map(x=>x.id===norm.id?norm:x)
      : [norm,...prev]);
  }

  async function handleDelete(id) {
    const res=await fetch(`${API}/api/receipts/${id}`,{method:"DELETE"});
    if(res.ok) setReceipts(prev=>prev.filter(x=>x.id!==id));
    else alert("Не удалось удалить чек");
  }

  async function handleUpdate(id, patch) {
    try {
      const res=await fetch(`${API}/api/receipts/${id}`,{
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

  const NAV=[{id:"svodka",icon:"▦",label:"Сводка"},{id:"operacii",icon:"≡",label:"Операции"},{id:"otchety",icon:"▤",label:"Отчёты"},{id:"nastroyki",icon:"⚙",label:"Настройки"}];
  const PT={svodka:"Сводка",operacii:"Операции",otchety:"Отчёты",nastroyki:"Настройки"};
  return (
    <div style={{maxWidth:480,margin:"0 auto",height:"100dvh",display:"flex",flexDirection:"column",background:C.light,fontFamily:FONT,overflow:"hidden"}}>
      <div style={{background:C.white,borderBottom:`1px solid ${C.silver}`,flexShrink:0}}>
        <div style={{padding:"11px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:38,height:38,background:"#ffffff",border:"1px solid #E8E4E0",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <svg width="32" height="7.5" viewBox="0 0 770 180" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M286.511 0C304.22 2.1117e-07 321.53 5.25113 336.254 15.0893C350.978 24.9276 362.454 38.911 369.231 55.2714C376.008 71.6317 377.781 89.6342 374.326 107.002C370.871 124.37 362.344 140.324 349.822 152.846C337.3 165.367 321.347 173.895 303.979 177.349C286.611 180.804 268.608 179.031 252.248 172.254C235.888 165.478 221.904 154.002 212.066 139.278C202.228 124.554 196.977 107.243 196.977 89.5349H230.233C230.233 100.666 233.534 111.546 239.718 120.801C245.902 130.056 254.691 137.269 264.975 141.529C275.258 145.788 286.574 146.903 297.491 144.731C308.408 142.56 318.435 137.2 326.306 129.329C334.177 121.459 339.537 111.431 341.708 100.514C343.88 89.5973 342.765 78.2817 338.506 67.9982C334.246 57.7147 327.033 48.9253 317.778 42.7414C308.523 36.5575 297.642 33.2569 286.511 33.2569V0Z" fill="#161A1D"/>
                <path d="M483.489 179.07C465.78 179.07 448.47 173.819 433.746 163.98C419.022 154.142 407.546 140.159 400.769 123.798C393.992 107.438 392.219 89.4357 395.674 72.0676C399.129 54.6995 407.656 38.7459 420.178 26.2243C432.7 13.7026 448.653 5.17523 466.021 1.7205C483.389 -1.73421 501.392 0.0388551 517.752 6.81554C534.112 13.5922 548.096 25.0681 557.934 39.7921C567.772 54.516 573.023 71.8266 573.023 89.535L539.767 89.535C539.767 78.4042 536.466 67.5235 530.282 58.2686C524.098 49.0137 515.309 41.8004 505.025 37.5409C494.742 33.2813 483.426 32.1668 472.509 34.3383C461.592 36.5098 451.565 41.8698 443.694 49.7404C435.823 57.611 430.463 67.6388 428.292 78.5557C426.12 89.4725 427.235 100.788 431.494 111.072C435.754 121.355 442.967 130.145 452.222 136.328C461.477 142.512 472.358 145.813 483.489 145.813L483.489 179.07Z" fill="#161A1D"/>
                <path d="M770 89.5349C770 107.243 764.749 124.554 754.911 139.278C745.072 154.002 731.089 165.478 714.729 172.254C698.368 179.031 680.366 180.804 662.998 177.349C645.63 173.895 629.676 165.367 617.154 152.846C604.633 140.324 596.105 124.37 592.651 107.002C589.196 89.6342 590.969 71.6317 597.746 55.2713C604.522 38.911 615.998 24.9276 630.722 15.0893C645.446 5.25112 662.757 -5.11009e-06 680.465 -3.91369e-06L680.465 33.2569C669.334 33.2569 658.454 36.5575 649.199 42.7414C639.944 48.9253 632.731 57.7147 628.471 67.9982C624.211 78.2817 623.097 89.5973 625.269 100.514C627.44 111.431 632.8 121.459 640.671 129.329C648.541 137.2 658.569 142.56 669.486 144.731C680.403 146.903 691.718 145.788 702.002 141.529C712.285 137.269 721.075 130.056 727.259 120.801C733.442 111.546 736.743 100.666 736.743 89.5349L770 89.5349Z" fill="#161A1D"/>
                <path d="M71.6279 0L0 179.07H35.814L89.5349 44.7674L143.256 179.07H179.07L107.442 0H71.6279Z" fill="#A4161A"/>
              </svg>
            </div>
            <div>
              <div style={{lineHeight:1.1}}>
                <span style={{fontSize:13,fontFamily:FONT,color:C.dark,letterSpacing:"0.08em",fontWeight:700}}>AI Офис</span>
                <span style={{fontSize:13,fontFamily:FONT,color:C.grayL,letterSpacing:"0.08em",fontWeight:400}}> | </span>
                <span style={{fontSize:13,fontFamily:FONT,color:C.cherry,letterSpacing:"0.08em",fontWeight:700}}>Чеки</span>
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
        {page==="svodka"&&<SvodkaPage receipts={receipts} activePeriod={activePeriod} setActivePeriod={setActivePeriod}/>}
        {page==="operacii"&&<OperaciiPage receipts={receipts} cards={cards} handleAdd={handleAdd} handleDelete={handleDelete} handleUpdate={handleUpdate} activePeriod={activePeriod} setActivePeriod={setActivePeriod}/>}
        {page==="otchety"&&<OtchetyPage receipts={receipts}/>}
        {page==="nastroyki"&&<NastroykiPage cards={cards} onAddCard={addCard} onUpdateCard={updateCard} onDeleteCard={deleteCard}/>}
      </div>
      <div style={{background:C.white,borderTop:`1px solid ${C.silver}`,display:"flex",flexShrink:0,paddingBottom:"env(safe-area-inset-bottom)"}}>
        {NAV.map(n=>(
          <button key={n.id} onClick={()=>setPage(n.id)} style={{flex:1,padding:"9px 0",border:"none",background:"transparent",display:"flex",flexDirection:"column",alignItems:"center",gap:3,cursor:"pointer",transition:"all 0.15s",borderRight:`1px solid ${C.silver}`}}>
            <span style={{fontSize:15,color:page===n.id?C.cherry:C.grayL}}>{n.icon}</span>
            <span style={{fontSize:10,letterSpacing:"0.1em",textTransform:"uppercase",fontFamily:FONT,color:page===n.id?C.cherry:C.grayL}}>{n.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
