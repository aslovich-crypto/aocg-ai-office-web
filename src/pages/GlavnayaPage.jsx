import { useEffect, useState } from "react";
import {
  Search,
  ScanLine,
  FileText,
  Tag,
  CircleX,
  Clock,
  ChevronRight,
  CreditCard,
} from "lucide-react";

import { computeTaxAccounting, regimeFlags } from "../lib/tax";

// Экран «Главная» (INT) — дашборд по образцу templates/home/Главная.html.
// Зависимости (данные, навигация, форматтеры) приходят пропсами из App.jsx,
// чтобы не дублировать хелперы и не наращивать монолит.

export default function GlavnayaPage({
  receipts,
  catalog,
  org,
  setPage,
  authFetch,
  C,
  FONT,
  fmt,
  fmtDate,
  plural,
  inPeriod,
  catName,
  catColor,
}) {
  const [reports, setReports] = useState([]);
  useEffect(() => {
    authFetch("/api/reports/")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setReports(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [authFetch]);

  const monthReceipts = receipts.filter((r) => inPeriod(r.date, "month"));
  const monthTotal = monthReceipts.reduce((s, r) => s + Number(r.amount), 0);

  // «Требует внимания»
  const noCat = receipts.filter((r) => catName(r) === "Без категории");
  const noCatSum = noCat.reduce((s, r) => s + Number(r.amount), 0);
  const rejected = reports.filter((r) => r.status === "Отклонён");
  const pending = reports.filter((r) => r.status === "На проверке");
  const pendingSum = pending.reduce((s, r) => s + Number(r.total || 0), 0);
  const monthName = new Date().toLocaleDateString("ru-RU", { month: "long" });
  const reportMonth = (r) =>
    r && r.created
      ? new Date(r.created).toLocaleDateString("ru-RU", { month: "long" })
      : "—";

  // Налоговый мини-блок (за месяц), только для режимов с учётом расходов
  const { deductible, nonDeductible, taxTotal } = computeTaxAccounting(
    monthReceipts,
    catalog,
  );
  const { reducesExpenses } = regimeFlags(org && org.tax_system);

  const recent = [...receipts]
    .sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0))
    .slice(0, 3);

  // ── стили ──
  const card = {
    background: C.white,
    border: `0.5px solid ${C.silver}`,
    borderRadius: 12,
    boxShadow: "0 1px 3px rgba(17,19,24,.06)",
  };
  const h2 = {
    font: `600 15px/1.2 ${FONT}`,
    color: "#111318",
    margin: "0 0 10px",
  };
  const tap = { cursor: "pointer" };

  const secTitle = (title, linkLabel, onLink) => (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 12,
        marginBottom: 10,
      }}
    >
      <span style={h2}>{title}</span>
      {linkLabel && (
        <span
          onClick={onLink}
          style={{
            font: `500 13px/1 ${FONT}`,
            color: C.cherry,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {linkLabel}
        </span>
      )}
    </div>
  );

  const quick = (Icon, label, onClick) => (
    <button
      onClick={onClick}
      style={{
        ...card,
        ...tap,
        padding: 16,
        minHeight: 104,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
        textAlign: "left",
      }}
    >
      <span
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          background: C.cherryTint || "#FDF2F2",
          color: C.cherry,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon size={22} strokeWidth={2} />
      </span>
      <span style={{ font: `600 15px/1.2 ${FONT}`, color: "#111318" }}>
        {label}
      </span>
    </button>
  );

  const attn = (Icon, color, num, text, capLabel, capValue, onClick) => (
    <button
      onClick={onClick}
      style={{
        ...card,
        ...tap,
        padding: "13px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 7,
        minWidth: 0,
        textAlign: "left",
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Icon size={17} color={color} strokeWidth={2} />
        <span
          style={{
            font: `700 26px/1 ${FONT}`,
            color: "#111318",
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-.015em",
          }}
        >
          {num}
        </span>
      </span>
      <span style={{ font: `500 12.5px/1.25 ${FONT}`, color: C.gray }}>
        {text}
      </span>
      <span
        style={{
          marginTop: "auto",
          paddingTop: 10,
          borderTop: `1px solid ${C.silver}`,
        }}
      >
        <span
          style={{
            display: "block",
            font: `500 11px/1.2 ${FONT}`,
            color: C.grayL,
            marginBottom: 3,
          }}
        >
          {capLabel}
        </span>
        <span
          style={{
            font: `600 13px/1.2 ${FONT}`,
            color: "#111318",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {capValue}
        </span>
      </span>
    </button>
  );

  const taxRow = (color, name, value, vcolor) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span
        style={{
          width: 9,
          height: 9,
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
        }}
      />
      <span style={{ flex: 1, font: `400 14px/1.3 ${FONT}`, color: "#111318" }}>
        {name}
      </span>
      <span
        style={{
          font: `600 14px/1.3 ${FONT}`,
          color: vcolor || "#111318",
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        {fmt(value)}
      </span>
    </div>
  );

  return (
    <div
      style={{ padding: "16px 16px calc(env(safe-area-inset-bottom) + 88px)" }}
    >
      {/* Поиск — запускает экран «Чеки» */}
      <button
        onClick={() => setPage("operacii")}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 9,
          background: C.lightGray,
          border: "none",
          borderRadius: 10,
          padding: "11px 12px",
          marginBottom: 22,
          cursor: "pointer",
        }}
      >
        <Search size={18} color={C.grayL} strokeWidth={2} />
        <span style={{ font: `400 15px/1.2 ${FONT}`, color: C.grayL }}>
          Поиск
        </span>
      </button>

      {/* Быстрые действия */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          marginBottom: 22,
        }}
      >
        {quick(ScanLine, "Сканировать чек", () => setPage("operacii"))}
        {quick(FileText, "Создать отчёт", () => setPage("otchety"))}
      </div>

      {/* Требует внимания */}
      <div style={{ marginBottom: 22 }}>
        {secTitle("Требует внимания")}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3,1fr)",
            gap: 10,
          }}
        >
          {attn(
            Tag,
            "#B45309",
            noCat.length,
            `${plural(noCat.length, ["чек", "чека", "чеков"])} без категории`,
            "Сумма",
            fmt(noCatSum),
            () => setPage("operacii"),
          )}
          {attn(
            CircleX,
            "#B91C1C",
            rejected.length,
            `${plural(rejected.length, [
              "отчёт",
              "отчёта",
              "отчётов",
            ])} отклонён`,
            "Период",
            rejected.length ? reportMonth(rejected[0]) : "—",
            () => setPage("otchety"),
          )}
          {attn(
            Clock,
            "#B45309",
            pending.length,
            `${plural(pending.length, [
              "отчёт",
              "отчёта",
              "отчётов",
            ])} на проверке`,
            "Сумма",
            fmt(pendingSum),
            () => setPage("otchety"),
          )}
        </div>
      </div>

      {/* За месяц */}
      <div style={{ marginBottom: 22 }}>
        {secTitle("За месяц")}
        <button
          onClick={() => setPage("svodka")}
          style={{
            ...card,
            ...tap,
            width: "100%",
            padding: 16,
            display: "flex",
            alignItems: "center",
            gap: 14,
            textAlign: "left",
          }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>
            <span
              style={{
                display: "block",
                font: `400 13px/1.3 ${FONT}`,
                color: C.gray,
                marginBottom: 4,
              }}
            >
              Расходы, {monthName}
            </span>
            <span
              style={{
                display: "block",
                font: `700 26px/1.05 ${FONT}`,
                color: "#111318",
                fontVariantNumeric: "tabular-nums",
                letterSpacing: "-.015em",
              }}
            >
              {fmt(monthTotal)}
            </span>
            <span
              style={{
                display: "block",
                font: `400 13px/1.3 ${FONT}`,
                color: C.gray,
                marginTop: 4,
              }}
            >
              {monthReceipts.length}{" "}
              {plural(monthReceipts.length, [
                "операция",
                "операции",
                "операций",
              ])}
            </span>
          </span>
          <ChevronRight size={22} color={C.grayL} strokeWidth={2} />
        </button>
      </div>

      {/* Налоговый учёт — мини, только для режимов с учётом расходов */}
      {org && reducesExpenses && (
        <div style={{ marginBottom: 22 }}>
          {secTitle("Налоговый учёт расходов")}
          <button
            onClick={() => setPage("svodka")}
            style={{
              ...card,
              ...tap,
              width: "100%",
              padding: 16,
              textAlign: "left",
            }}
          >
            <span
              style={{
                display: "flex",
                height: 12,
                borderRadius: 999,
                overflow: "hidden",
                gap: 2,
              }}
            >
              <span
                style={{
                  flex: `0 0 ${
                    taxTotal > 0 ? (deductible / taxTotal) * 100 : 0
                  }%`,
                  background: "#15803D",
                }}
              />
              <span
                style={{
                  flex: `0 0 ${
                    taxTotal > 0 ? (nonDeductible / taxTotal) * 100 : 0
                  }%`,
                  background: "#9CA3AF",
                }}
              />
            </span>
            <span
              style={{
                marginTop: 14,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {taxRow(
                "#15803D",
                "Можно учесть в расходах",
                deductible,
                "#15803D",
              )}
              {taxRow("#9CA3AF", "Нельзя учесть", nonDeductible)}
            </span>
          </button>
        </div>
      )}

      {/* Последние */}
      <div>
        {secTitle("Последние", "Все чеки", () => setPage("operacii"))}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {recent.map((r) => {
            const pill = catColor(catName(r)) || {};
            return (
              <button
                key={r.id}
                onClick={() => setPage("operacii")}
                style={{
                  ...card,
                  ...tap,
                  padding: "14px 16px",
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 12,
                  textAlign: "left",
                  boxShadow: "0 1px 3px rgba(17,19,24,.08)",
                }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      display: "block",
                      font: `500 15px/1.25 ${FONT}`,
                      color: "#111318",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {r.org}
                  </span>
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      marginTop: 4,
                      font: `400 13px/1.2 ${FONT}`,
                      color: C.gray,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    <span>{fmtDate(r.date)}</span>
                    <span
                      style={{
                        width: 3,
                        height: 3,
                        borderRadius: "50%",
                        background: C.grayL,
                      }}
                    />
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <CreditCard size={14} color={C.gray} strokeWidth={2} />
                      {r.card_last4 || r.payment || "—"}
                    </span>
                  </span>
                </span>
                <span
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: 7,
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      font: `600 15px/1.2 ${FONT}`,
                      color: "#111318",
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {fmt(Number(r.amount))}
                  </span>
                  <span
                    style={{
                      font: `500 12px/1 ${FONT}`,
                      padding: "5px 10px",
                      borderRadius: 999,
                      background: pill.bg || C.lightGray,
                      color: pill.fg || C.gray,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {catName(r)}
                  </span>
                </span>
              </button>
            );
          })}
          {recent.length === 0 && (
            <div
              style={{
                font: `400 13px/1.4 ${FONT}`,
                color: C.grayL,
                padding: "8px 0",
              }}
            >
              Пока нет чеков
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
