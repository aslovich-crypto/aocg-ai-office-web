import { useState, useEffect, useRef } from "react";
import { snapdom } from "@zumer/snapdom";
import {
  ChevronLeft,
  Share2,
  MoreHorizontal,
  Trash2,
  MapPin,
  BadgeCheck,
  ChevronDown,
  CreditCard,
  Banknote,
  Landmark,
  Check,
} from "lucide-react";
import { C, FONT } from "../lib/theme";
import { shortOrg, fmtDate, fmtDateTime } from "../lib/format";
import { catName, catColor } from "../lib/categories";
import { useModalA11y } from "../hooks/useModalA11y";
import CategorySheet from "./CategorySheet";

// Токены дизайн-системы (colors_and_type.css), смапленные на палитру C +
// несколько литералов, которых нет в C (success/error/cherry-hover).
const T = {
  fg1: "#111318",
  fg2: C.gray, // #636B7D
  fg3: C.grayL, // #9CA3AF
  border: C.silver, // #EEF0F4
  borderStrong: C.borderD, // #E2E5EB
  chipBg: "#F1F5F9",
  successBg: "#F0FDF4",
  successFg: "#15803D",
  errorFg: "#B91C1C",
  cherry: C.cherry,
  cherryHover: "#8B1218",
  white: C.white,
};

const money = (n) =>
  Number(n || 0).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + " ₽";

// Коды СНО колонки receipts.tax_system (мэппинг бэка fns_parser) → русские метки.
// Это НЕ TAX_LABELS из lib/tax — там другой набор кодов (для организаций).
const TAX_LABELS_RECEIPT = {
  osno: "ОСНО",
  usn_income: "УСН «Доходы»",
  usn_income_minus_expense: "УСН «Доходы−Расходы»",
  envd: "ЕНВД",
  eshn: "ЕСХН",
  psn: "Патент",
  npd: "НПД",
};

// Количество позиции: целое → «N шт», дробное (весовой товар) → как есть.
function qtyLabel(q) {
  if (q === undefined || q === null || q === "") return "";
  const n = Number(q);
  if (!isFinite(n)) return "";
  return Number.isInteger(n) ? `${n} шт` : n.toLocaleString("ru-RU");
}

// Ставка НДС позиции по коду ФНС (tag 1199) ИЛИ строке (OCR). Не падает, если поля нет.
// D3: только ставка, сумму НДС по строке НЕ вычисляем.
function vatRateLabel(nds) {
  if (nds === undefined || nds === null || nds === "") return "";
  const s = String(nds).trim();
  if (s === "1" || s === "3") return "НДС 20%"; // 20% и расч. 20/120
  if (s === "2" || s === "4") return "НДС 10%"; // 10% и расч. 10/110
  if (s === "5" || s === "6") return "Без НДС"; // 0% / не облагается
  if (/20/.test(s)) return "НДС 20%"; // OCR-строки "20"/"10"/"0"
  if (/10/.test(s)) return "НДС 10%";
  if (/^0/.test(s) || /без/i.test(s)) return "Без НДС";
  return "";
}

// Иконка способа оплаты — статический компонент (объявлен вне render, чтобы не
// плодить «компонент при рендере»): карта по умолчанию, наличные, счёт компании.
function PayGlyph({ value, size = 16, color, style }) {
  if (value && /нал/i.test(value))
    return <Banknote size={size} color={color} style={style} />;
  if (value && /сч[её]т/i.test(value))
    return <Landmark size={size} color={color} style={style} />;
  return <CreditCard size={size} color={color} style={style} />;
}
function payLabel(v) {
  if (!v) return "Оплата";
  const i = v.indexOf("•");
  return i >= 0 ? v.slice(i + 1).trim() : v;
}

// ── внутренняя нижняя шторка (оплата + подтверждение удаления) ──────────────
function Sheet({ title, onClose, children }) {
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
        position: "absolute",
        inset: 0,
        background: "rgba(22,26,29,0.45)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 60,
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
          background: T.white,
          width: "100%",
          borderRadius: "20px 20px 0 0",
          transform: shown ? "translateY(0)" : "translateY(100%)",
          transition: `transform ${shown ? 280 : 220}ms ${EASE}`,
          padding: "8px 16px calc(16px + env(safe-area-inset-bottom))",
          maxHeight: "80%",
          overflowY: "auto",
          outline: "none",
        }}
      >
        <div
          style={{
            width: 38,
            height: 4,
            borderRadius: 999,
            background: "#D7DAE0",
            margin: "8px auto 14px",
          }}
        />
        {title && (
          <h3
            style={{
              font: `600 17px/1 ${FONT}`,
              color: T.fg1,
              margin: "0 0 12px",
              padding: "0 2px",
            }}
          >
            {title}
          </h3>
        )}
        {children}
      </div>
    </div>
  );
}

const optStyle = (sel) => ({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  width: "100%",
  background: sel ? "#FDF2F2" : "none",
  border: "none",
  cursor: "pointer",
  padding: "14px 12px",
  borderRadius: 10,
  font: `500 15px/1 ${FONT}`,
  color: T.fg1,
  textAlign: "left",
});

function PaymentSheet({ options, selected, onPick, onClose }) {
  return (
    <Sheet title="Метод оплаты" onClose={onClose}>
      {options.map((opt) => {
        const sel = selected === opt;
        return (
          <button key={opt} onClick={() => onPick(opt)} style={optStyle(sel)}>
            <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <PayGlyph value={opt} size={18} color={T.fg2} />
              {opt}
            </span>
            {sel && <Check size={20} color={T.cherry} />}
          </button>
        );
      })}
      {options.length === 0 && (
        <div
          style={{
            padding: "20px 12px",
            fontFamily: FONT,
            fontSize: 13,
            color: T.fg3,
            textAlign: "center",
          }}
        >
          Нет доступных способов оплаты
        </div>
      )}
    </Sheet>
  );
}

function ConfirmDeleteSheet({ onConfirm, onClose }) {
  return (
    <Sheet title="Удалить чек?" onClose={onClose}>
      <p
        style={{
          font: `400 14px/1.45 ${FONT}`,
          color: T.fg2,
          margin: "0 2px 16px",
        }}
      >
        Чек будет удалён без возможности восстановления.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={onClose}
          style={{
            flex: 1,
            height: 48,
            borderRadius: 8,
            border: `1px solid ${T.borderStrong}`,
            background: T.white,
            font: `500 15px/1 ${FONT}`,
            color: T.fg1,
            cursor: "pointer",
          }}
        >
          Отмена
        </button>
        <button
          onClick={onConfirm}
          style={{
            flex: 1,
            height: 48,
            borderRadius: 8,
            border: "none",
            background: T.errorFg,
            font: `600 15px/1 ${FONT}`,
            color: "#fff",
            cursor: "pointer",
          }}
        >
          Удалить
        </button>
      </div>
    </Sheet>
  );
}

// ── карточка чека (вложенный экран, Тип 3) ─────────────────────────────────
export default function ReceiptDetailModal({
  receipt,
  onClose,
  onDelete,
  onChangeCategory,
  onChangePayment,
  catalog,
  paymentOptions = [],
}) {
  const r = receipt;
  const raw = r.raw_data || {};
  const isFns = r.source === "fns" || r.source === "qr_scan";
  // raw_data-суммы (ФНС) — в копейках; колонки (amount, vat_*) — уже в рублях.
  const fromKop = (v) => (v == null || v === "" ? null : Number(v) / 100);

  // ── шапка: основа из колонок (работает для fns/qr/photo_ocr/manual) ──
  const mname = r.org_brand || shortOrg(r.org_legal || r.org) || "Чек";
  const seller = r.org_legal && r.org_legal !== mname ? r.org_legal : "";
  const inn = r.org_inn || "";
  const taxLabel = r.tax_system ? TAX_LABELS_RECEIPT[r.tax_system] || "" : "";
  const innLine = inn
    ? `ИНН ${inn}${taxLabel ? ` · ${taxLabel}` : ""}`
    : taxLabel;
  const address = r.address || "";
  const totalSum = Number(r.amount) || fromKop(raw.totalSum) || 0;
  const when = r.datetime
    ? fmtDateTime(r.datetime)
    : r.date
      ? fmtDate(r.date)
      : "";
  const fnsVerified = isFns;

  // ── признак расчёта: тег только когда ≠ «Приход» (D4) ──
  const OP_LABELS = {
    purchase: "Приход",
    refund: "Возврат прихода",
    expense: "Расход",
    expense_refund: "Возврат расхода",
  };
  const opLabel =
    r.operation_type && r.operation_type !== "purchase"
      ? OP_LABELS[r.operation_type] || ""
      : "";
  const opTag = /возврат/i.test(opLabel)
    ? { bg: "#FEF2F2", fg: "#B91C1C" } // возврат → красный
    : { bg: "#FFFBEB", fg: "#B45309" }; // расход → янтарный

  // ── НДС-итоги: только реальный НДС (vat_20 / vat_10), колонки в рублях.
  // vat_0 («Без НДС») НЕ показываем — на спецрежимах он равен Итого (шум). ──
  const vatRows = [
    ["НДС 20%", r.vat_20],
    ["НДС 10%", r.vat_10],
  ].filter(([, v]) => Number(v) > 0);
  // ── разбивка оплаты — ТОЛЬКО при смешанной (и наличные, и безнал > 0);
  // при одном способе равна Итого → дублирует, не рисуем. raw_data, ÷100 при isFns. ──
  const cashSum = isFns ? fromKop(raw.cashTotalSum) : null;
  const cardSum = isFns ? fromKop(raw.ecashTotalSum) : null;
  const payRows =
    cashSum > 0 && cardSum > 0
      ? [
          ["Наличными", cashSum],
          ["Картой", cardSum],
        ]
      : [];
  const totalRows = [...vatRows, ...payRows];

  // ── позиции: только из raw_data (receipt_items фронту не отдаётся, D1);
  // единицы — по источнику: ФНС → копейки (÷100), OCR → уже рубли (D2). ──
  const items = Array.isArray(raw.items) ? raw.items : [];
  const itemSum = (it) =>
    isFns ? Number(it.sum || 0) / 100 : Number(it.sum || 0);

  // ── фискалка: из колонок; Смена·Чек — из raw_data (есть только у fns/qr) ──
  const shiftCheck = [raw.shiftNumber, raw.requestNumber]
    .filter((x) => x !== undefined && x !== null && x !== "")
    .join(" · ");
  const fiscalRows = [
    ["Рег. номер ККТ", r.kkt_rn, true],
    ["ФН №", r.kkt_fn, true],
    ["ФД №", r.fd_num, true],
    ["ФПД", r.fpd, true],
    ["ЗН ККТ", r.kkt_serial, true],
    ["Смена № · Чек №", shiftCheck, true],
    ["Кассир", r.cashier, false], // sans, не моно
  ].filter((x) => x[1]);

  // Категория и оплата сохраняются мгновенно: тап в шторке → сразу PATCH через
  // onChangeCategory/onChangePayment (как в дореформенной модалке). Локального
  // накопления правок и кнопки «Сохранить» нет.
  const [showCat, setShowCat] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showTip, setShowTip] = useState(false);
  const [fiscalOpen, setFiscalOpen] = useState(false);

  // PNG-шеринг карточки (контейнер контента, без шапки и футера).
  const contentRef = useRef(null);
  const [sharing, setSharing] = useState(false);
  async function handleShare() {
    const node = contentRef.current;
    if (!node || sharing) return;
    setSharing(true);
    try {
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      const snap = await snapdom(node, {
        scale,
        backgroundColor: "#F6F7F9",
        embedFonts: true,
      });
      const canvas = await snap.toCanvas();
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
      const filename = `receipt-${amountPart}-${datePart}.png`;
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
        console.error("receipt share failed", e);
        alert("Не удалось подготовить изображение чека");
      }
    } finally {
      setSharing(false);
    }
  }

  const dialogRef = useModalA11y(onClose);
  const catCol = catColor(catName(r));

  const blockStyle = {
    background: T.white,
    borderRadius: 12,
    boxShadow: "0 1px 3px rgba(17,19,24,.04)",
  };
  const hbtn = {
    display: "flex",
    alignItems: "center",
    gap: 2,
    background: "none",
    border: "none",
    cursor: "pointer",
    color: T.fg1,
    padding: 8,
    borderRadius: 8,
    font: `400 16px/1 ${FONT}`,
  };
  const iconBtn = {
    ...hbtn,
    width: 40,
    height: 40,
    justifyContent: "center",
  };

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
        aria-label="Детали чека"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          background: C.light,
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
        {/* ── header (Тип 3) ── */}
        <header
          style={{
            background: T.white,
            borderBottom: `1px solid ${T.border}`,
            flexShrink: 0,
            position: "relative",
            zIndex: 40,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              minHeight: 52,
              padding: "6px 8px",
            }}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Назад"
              style={{ ...hbtn, marginLeft: -2 }}
            >
              <ChevronLeft size={22} />
              Назад
            </button>
            <div
              style={{
                flex: 1,
                textAlign: "center",
                font: `600 17px/1 ${FONT}`,
                color: T.fg1,
              }}
            >
              Чек
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
              <button
                type="button"
                onClick={handleShare}
                disabled={sharing}
                aria-label="Поделиться"
                style={{ ...iconBtn, color: sharing ? T.fg3 : T.fg1 }}
              >
                <Share2 size={21} />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((v) => !v);
                }}
                aria-label="Ещё"
                style={iconBtn}
              >
                <MoreHorizontal size={22} />
              </button>
            </div>
          </div>
          {menuOpen && (
            <>
              <div
                onClick={() => setMenuOpen(false)}
                style={{ position: "fixed", inset: 0, zIndex: 49 }}
              />
              <div
                style={{
                  position: "absolute",
                  top: 54,
                  right: 10,
                  background: T.white,
                  borderRadius: 12,
                  boxShadow: "0 8px 30px rgba(17,19,24,.18)",
                  border: `1px solid ${T.border}`,
                  minWidth: 200,
                  padding: 6,
                  zIndex: 50,
                  overflow: "hidden",
                }}
              >
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setConfirmDel(true);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: "11px 12px",
                    borderRadius: 8,
                    font: `400 15px/1 ${FONT}`,
                    color: T.errorFg,
                    textAlign: "left",
                  }}
                >
                  <Trash2 size={18} />
                  Удалить чек
                </button>
              </div>
            </>
          )}
        </header>

        {/* ── scroll body ── */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          <div
            ref={contentRef}
            style={{
              padding: "16px 16px 20px",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {/* 1 · hero */}
            <section style={{ ...blockStyle, padding: 16 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 16,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 5,
                    minWidth: 0,
                    flex: 1,
                  }}
                >
                  <div
                    style={{
                      font: `600 18px/1.25 ${FONT}`,
                      color: T.fg1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {mname}
                  </div>
                  {seller && (
                    <div
                      style={{
                        font: `400 13px/1.4 ${FONT}`,
                        color: T.fg2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {seller}
                    </div>
                  )}
                  {innLine && (
                    <div
                      style={{
                        font: `400 13px/1.4 ${FONT}`,
                        color: T.fg2,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {innLine}
                    </div>
                  )}
                  {address && (
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        font: `400 13px/1.4 ${FONT}`,
                        color: T.fg2,
                        minWidth: 0,
                      }}
                    >
                      <MapPin
                        size={13}
                        color={T.fg3}
                        style={{ flexShrink: 0, transform: "translateY(.5px)" }}
                      />
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {address}
                      </span>
                    </div>
                  )}
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: 6,
                    flexShrink: 0,
                  }}
                >
                  <div
                    style={{
                      font: `700 26px/1.05 ${FONT}`,
                      color: T.fg1,
                      fontVariantNumeric: "tabular-nums",
                      letterSpacing: "-.02em",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {money(totalSum)}
                  </div>
                  {opLabel && (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        background: opTag.bg,
                        color: opTag.fg,
                        borderRadius: 999,
                        padding: "3px 8px",
                        font: `600 12px/1 ${FONT}`,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {opLabel}
                    </span>
                  )}
                  {fnsVerified && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowTip((v) => !v);
                      }}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        border: "none",
                        cursor: "pointer",
                        background: T.successBg,
                        color: T.successFg,
                        borderRadius: 999,
                        padding: "3px 8px",
                        font: `500 13px/1 ${FONT}`,
                        position: "relative",
                      }}
                    >
                      <BadgeCheck
                        size={14}
                        style={{ transform: "translateY(.5px)" }}
                      />
                      <span>ФНС</span>
                      {showTip && (
                        <span
                          style={{
                            position: "absolute",
                            top: "calc(100% + 6px)",
                            right: 0,
                            whiteSpace: "nowrap",
                            background: T.fg1,
                            color: "#fff",
                            font: `400 12px/1 ${FONT}`,
                            padding: "7px 10px",
                            borderRadius: 8,
                            boxShadow: "0 4px 14px rgba(17,19,24,.18)",
                            zIndex: 6,
                          }}
                        >
                          Проверен в ФНС
                        </span>
                      )}
                    </button>
                  )}
                  <div
                    style={{
                      font: `400 13px/1.3 ${FONT}`,
                      color: T.fg2,
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {when}
                  </div>
                </div>
              </div>
            </section>

            {/* 5 · items (скрыт, если состав недоступен) */}
            {items.length > 0 && (
              <section style={{ ...blockStyle, padding: "14px 16px 6px" }}>
                <div
                  style={{
                    font: `600 13px/1 ${FONT}`,
                    color: T.fg2,
                    marginBottom: 4,
                  }}
                >
                  Позиции
                </div>
                {items.map((it, i) => {
                  const lineSum = itemSum(it);
                  const unitPrice = isFns
                    ? Number(it.price || 0) / 100
                    : Number(it.price || 0);
                  const qNum = Number(it.quantity);
                  const qStr =
                    isFinite(qNum) && qNum
                      ? Number.isInteger(qNum)
                        ? String(qNum)
                        : qNum.toLocaleString("ru-RU")
                      : "";
                  // ненулевая цена → «кол-во × цена»; нулевая (модификаторы) → просто «N шт»
                  const meta =
                    unitPrice > 0
                      ? `${qStr || "1"} × ${money(unitPrice)}`
                      : qtyLabel(it.quantity);
                  // бейдж ставки только для реального НДС (20/10); «Без НДС» = норма, не маркируем
                  const vat = vatRateLabel(it.nds);
                  const showVat = vat === "НДС 20%" || vat === "НДС 10%";
                  return (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        justifyContent: "space-between",
                        gap: 14,
                        padding: "11px 0",
                        borderTop: i === 0 ? "none" : `1px solid ${T.border}`,
                      }}
                    >
                      <div
                        style={{
                          minWidth: 0,
                          display: "flex",
                          flexDirection: "column",
                          gap: 3,
                        }}
                      >
                        <span
                          style={{
                            font: `400 14px/1.35 ${FONT}`,
                            color: T.fg1,
                          }}
                        >
                          {it.name || "—"}
                        </span>
                        {(meta || showVat) && (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 8,
                              flexWrap: "wrap",
                            }}
                          >
                            {meta && (
                              <span
                                style={{
                                  font: `400 12px/1.2 ${FONT}`,
                                  color: T.fg2,
                                  fontVariantNumeric: "tabular-nums",
                                }}
                              >
                                {meta}
                              </span>
                            )}
                            {showVat && (
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  background: T.chipBg,
                                  color: T.fg2,
                                  borderRadius: 999,
                                  padding: "1px 7px",
                                  font: `500 11px/1.5 ${FONT}`,
                                }}
                              >
                                {vat}
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                      <span
                        style={{
                          font: `500 14px/1.3 ${FONT}`,
                          color: T.fg1,
                          fontVariantNumeric: "tabular-nums",
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                          textAlign: "right",
                        }}
                      >
                        {money(lineSum)}
                      </span>
                    </div>
                  );
                })}
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    padding: "13px 0 4px",
                    borderTop: `1px solid ${T.borderStrong}`,
                    marginTop: 2,
                  }}
                >
                  <span style={{ font: `600 14px/1 ${FONT}`, color: T.fg1 }}>
                    Итого
                  </span>
                  <span
                    style={{
                      font: `700 16px/1 ${FONT}`,
                      color: T.fg1,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {money(totalSum)}
                  </span>
                </div>
                {totalRows.map(([k, v]) => (
                  <div
                    key={k}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "5px 0",
                      font: `400 13px/1.3 ${FONT}`,
                      color: T.fg2,
                    }}
                  >
                    <span>{k}</span>
                    <span
                      style={{
                        color: T.fg1,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {money(v)}
                    </span>
                  </div>
                ))}
              </section>
            )}

            {/* 6 · fiscal (сворачиваемый; скрыт, если реквизитов нет) */}
            {fiscalRows.length > 0 && (
              <section style={{ ...blockStyle, overflow: "hidden" }}>
                <button
                  type="button"
                  onClick={() => setFiscalOpen((v) => !v)}
                  aria-expanded={fiscalOpen}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: 16,
                    cursor: "pointer",
                    background: "none",
                    border: "none",
                    width: "100%",
                    font: `600 14px/1 ${FONT}`,
                    color: T.fg1,
                  }}
                >
                  <span>Фискальные реквизиты</span>
                  <ChevronDown
                    size={20}
                    color={T.fg3}
                    style={{
                      transition: "transform 200ms ease",
                      transform: fiscalOpen ? "rotate(180deg)" : "none",
                    }}
                  />
                </button>
                {fiscalOpen && (
                  <div style={{ padding: "0 16px 18px" }}>
                    {fiscalRows.map(([k, v, mono], i) => (
                      <div
                        key={k}
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          justifyContent: "space-between",
                          gap: 16,
                          padding: "10px 0",
                          borderTop: i === 0 ? "none" : `1px solid ${T.border}`,
                        }}
                      >
                        <span
                          style={{
                            font: `400 13px/1.3 ${FONT}`,
                            color: T.fg2,
                            flexShrink: 0,
                          }}
                        >
                          {k}
                        </span>
                        <span
                          style={{
                            fontFamily: mono
                              ? "'Courier New', Courier, ui-monospace, monospace"
                              : FONT,
                            fontSize: 13,
                            lineHeight: 1.3,
                            color: T.fg1,
                            fontVariantNumeric: "tabular-nums",
                            textAlign: "right",
                            wordBreak: "break-all",
                          }}
                        >
                          {v}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        </div>

        {/* ── sticky footer: чипы правки + Сохранить (только при изменениях) ── */}
        <div
          style={{
            background: "rgba(255,255,255,.92)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            borderTop: `1px solid ${T.border}`,
            padding: "12px 16px calc(12px + env(safe-area-inset-bottom))",
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => catalog && onChangeCategory && setShowCat(true)}
              disabled={!catalog || !onChangeCategory}
              style={{
                flex: 1.5,
                minWidth: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 6,
                background: T.chipBg,
                border: "none",
                borderRadius: 999,
                padding: "11px 12px 11px 14px",
                cursor: catalog && onChangeCategory ? "pointer" : "default",
                font: `500 13px/1.2 ${FONT}`,
                color: T.fg1,
              }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 999,
                    flexShrink: 0,
                    background: catCol.fg,
                  }}
                />
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {catName(r)}
                </span>
              </span>
              <ChevronDown size={16} color={T.fg2} style={{ flexShrink: 0 }} />
            </button>
            {onChangePayment && (
              <button
                type="button"
                onClick={() => setShowPay(true)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 6,
                  background: T.chipBg,
                  border: "none",
                  borderRadius: 999,
                  padding: "11px 12px 11px 14px",
                  cursor: "pointer",
                  font: `500 13px/1.2 ${FONT}`,
                  color: T.fg1,
                }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    minWidth: 0,
                  }}
                >
                  <PayGlyph
                    value={r.payment}
                    size={16}
                    color={T.fg2}
                    style={{ flexShrink: 0 }}
                  />
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {payLabel(r.payment)}
                  </span>
                </span>
                <ChevronDown
                  size={16}
                  color={T.fg2}
                  style={{ flexShrink: 0 }}
                />
              </button>
            )}
          </div>
        </div>

        {/* ── шторки ── */}
        {showPay && (
          <PaymentSheet
            options={paymentOptions}
            selected={r.payment}
            onPick={(opt) => {
              onChangePayment(opt);
              setShowPay(false);
            }}
            onClose={() => setShowPay(false)}
          />
        )}
        {confirmDel && (
          <ConfirmDeleteSheet
            onConfirm={onDelete}
            onClose={() => setConfirmDel(false)}
          />
        )}
        {showCat && (
          <CategorySheet
            catalog={catalog}
            selected={catName(r)}
            onPick={onChangeCategory}
            onClose={() => setShowCat(false)}
          />
        )}
      </div>
    </div>
  );
}
