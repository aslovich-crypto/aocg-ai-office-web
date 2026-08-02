import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
} from "react";
import { Html5Qrcode, Html5QrcodeScannerState } from "html5-qrcode";
import jsQR from "jsqr";
import { Camera, ImageUp, PenLine, Flashlight, FileText } from "lucide-react";

import { useModalA11y } from "../hooks/useModalA11y";
import { C, FONT, theme } from "../lib/theme";
import { fmtDate } from "../lib/format";
import { parseQRString } from "../lib/qr";

// Экран сканирования чека — вынесен из App.jsx как ЕДИНЫЙ кусок (ЧП1, INT).
// Дробить дальше намеренно НЕ стали: жизненный цикл камеры (releaseCamera),
// cbRef-трюк, привязки к DOM html5-qrcode, отсутствие qrbox и жизненный цикл
// objectURL — связаны между собой; разнесение по файлам их бы задело.

// L-shaped corner markers for the cutout. Four absolutely-positioned divs,
// each drawing the two relevant borders. Color animates between white (idle)
// and #15803D (just captured) via a 300ms transition on border-color.
// Уголки прижаты к углам РОДИТЕЛЬСКОЙ коробки выреза (раньше считались от
// центра вьюпорта) — геометрия рамки теперь задаётся в одном месте, самой
// коробкой. Размер 38×38 по макету: 20×20 терялись на пёстром фоне (UX-2).
function CutoutCorners({ color, len = 38, thick = 3 }) {
  const transition = "border-color 300ms ease";
  const base = {
    position: "absolute",
    width: len,
    height: len,
    borderRadius: 4,
    transition,
    pointerEvents: "none",
  };
  const tl = {
    ...base,
    top: 0,
    left: 0,
    borderTop: `${thick}px solid ${color}`,
    borderLeft: `${thick}px solid ${color}`,
  };
  const tr = {
    ...base,
    top: 0,
    right: 0,
    borderTop: `${thick}px solid ${color}`,
    borderRight: `${thick}px solid ${color}`,
  };
  const bl = {
    ...base,
    bottom: 0,
    left: 0,
    borderBottom: `${thick}px solid ${color}`,
    borderLeft: `${thick}px solid ${color}`,
  };
  const br = {
    ...base,
    bottom: 0,
    right: 0,
    borderBottom: `${thick}px solid ${color}`,
    borderRight: `${thick}px solid ${color}`,
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

export default function ScanReceiptModal({
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

  // ─── Геометрия видоискателя (UX-2) ─────────────────────────────
  // Рамка центрируется в ВИДИМОЙ полосе между верхней и нижней панелями,
  // а не по полной высоте вьюпорта. Раньше было calc(50% - 135px) от корня:
  // высота нижней панели в расчёте не участвовала, и на коротких экранах
  // (iPhone в Safari с тулбарами) нижние уголки уходили под панель действий.
  // Верхняя панель структурно постоянна → константа; нижняя меняется по фазам
  // и safe-area → измеряется. Обе величины включают safe-area, поэтому она
  // учтена и в рамке, а не только в паддинге панели.
  // ВНИМАНИЕ: значение завязано на СТРУКТУРУ верхней панели (см. блок «Top bar»
  // ниже): padding calc(env(safe-area-inset-top) + 12px) сверху + кнопка 44px +
  // 12px снизу = env + 68px. Меняешь высоту кнопок или паддинги топбара —
  // обнови и это число, иначе рамка молча съедет вниз/вверх. Нижнюю панель не
  // хардкодим: её высота зависит от фазы, поэтому измеряется.
  const TOPBAR_H = "(env(safe-area-inset-top) + 68px)";
  const panelRef = useRef(null);
  // Начальное значение — оценка панели фазы scanning (18 + 52 + 12 + 52 + 12 +
  // ~25 текстовая кнопка + 20 + safe-area). Нужна на случай, если измерение
  // невозможно; при обычном рендере useLayoutEffect подставляет фактическую
  // высоту ДО первой отрисовки, поэтому прыжка рамки не бывает.
  const [panelH, setPanelH] = useState(
    "calc(191px + env(safe-area-inset-bottom))",
  );
  useLayoutEffect(() => {
    // Измеряем только в фазе scanning: в captured панель становится ниже,
    // и рамка иначе прыгала бы ровно в момент подтверждения захвата.
    if (phase !== "scanning") return;
    const el = panelRef.current;
    if (!el) return;
    const measure = () => setPanelH(`${el.offsetHeight}px`);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [phase]);
  // Верх выреза = низ верхней панели + половина свободного места под рамку.
  // max(0px, …) — страховка для экранов, где полоса уже самой рамки.
  const HOLE_TOP = `${TOPBAR_H} + max(0px, (100% - ${TOPBAR_H} - ${panelH} - ${CUTOUT}px) / 2)`;
  const holeTop = `calc(${HOLE_TOP})`;
  const holeBottomEdge = `calc(${HOLE_TOP} + ${CUTOUT}px)`;
  const sideWidth = `calc(50% - ${CUTOUT / 2}px)`;

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
    // НЕ добавлять releaseCamera в зависимости. Пустой массив здесь
    // намеренный: колбэки живут в cbRef (см. комментарий у объявления
    // cbRef выше), а новая identity этого useCallback перезапустила бы
    // эффект камеры → teardown/старт html5-qrcode посреди сканирования →
    // «Cannot clear while scan is ongoing» и белый экран. Это пункт из
    // списка рисков ЧП1 (вынос ScanReceiptModal), проверенный на живом
    // устройстве. Правка зависимостей — только вместе с разбором
    // жизненного цикла камеры, не «по подсказке линтера».
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        // width брали в 100vw — единица считает ширину БЕЗ учёта того, что
        // видимая область на iOS уже layout-вьюпорта, и элемент может стать
        // шире экрана, дав горизонтальную прокрутку документа. inset:0 уже
        // растягивает по вьюпорту, отдельная ширина не нужна.
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
          transparent CUTOUT×CUTOUT square. Позиция выреза считается от ВИДИМОЙ
          полосы (holeTop), поэтому нижние уголки не могут уехать под панель
          действий ни на одном экране — каркас исключает перекрытие, и поднимать
          рамку над панелью по z-order не требуется. Hidden during loading /
          error phases (where we use a uniform full-screen dim instead). */}
      {!dimmed && phase !== "preview" && (
        <>
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: holeTop,
              background: "rgba(0,0,0,0.55)",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: holeBottomEdge,
              left: 0,
              right: 0,
              bottom: 0,
              background: "rgba(0,0,0,0.55)",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: holeTop,
              height: CUTOUT,
              left: 0,
              width: sideWidth,
              background: "rgba(0,0,0,0.55)",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: holeTop,
              height: CUTOUT,
              right: 0,
              width: sideWidth,
              background: "rgba(0,0,0,0.55)",
            }}
          />
          {/* Коробка выреза — единственный источник геометрии рамки */}
          <div
            style={{
              position: "absolute",
              top: holeTop,
              left: sideWidth,
              width: CUTOUT,
              height: CUTOUT,
              pointerEvents: "none",
            }}
          >
            <CutoutCorners color={cornerColor} />
          </div>
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
            // над вырезом: 18px выше его верхней грани (та же модель, что рамка,
            // — раньше считалось от центра вьюпорта и уезжало под панель)
            bottom: `calc(100% - (${HOLE_TOP}) + 18px)`,
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
            zIndex: 7, // выше панели (6) — раньше 5 и подсказка пряталась под ней
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
          ref={panelRef} // измеряется для центрирования рамки в видимой полосе
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
                    color: theme.fg2,
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
                  background: theme.surfaceSunk,
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
                  stroke={theme.cherry}
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
                  background: theme.surfaceSunk,
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
                  color: theme.fg2,
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
                    background: theme.cherry,
                    border: "none",
                    borderRadius: 12,
                    fontFamily: FONT,
                    fontSize: 14,
                    fontWeight: 600,
                    color: theme.surface,
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
                  background: theme.surface,
                  border: `1px solid ${theme.border}`,
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
                  color: theme.fg2,
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
                background: theme.cherry,
                border: "none",
                borderRadius: 12,
                fontFamily: FONT,
                fontSize: 14,
                fontWeight: 600,
                color: theme.surface,
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
                    background: theme.cherry,
                    border: "none",
                    borderRadius: 12,
                    fontFamily: FONT,
                    fontSize: 14,
                    fontWeight: 600,
                    color: theme.surface,
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
                    background: theme.cherry,
                    border: "none",
                    borderRadius: 12,
                    fontFamily: FONT,
                    fontSize: 14,
                    fontWeight: 600,
                    color: theme.surface,
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
