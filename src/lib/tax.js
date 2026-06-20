// Налоговый учёт расходов — общие расчёты для экранов «Сводка» и «Главная» (INT).
// Зеркало серверного organizations.tax_system (TAX_SYSTEMS в organizations.py).

export const TAX_LABELS = {
  osno: "ОСНО",
  usn_d: "УСН «Доходы»",
  usn_dr: "УСН «Доходы−Расходы»",
  psn: "Патент",
  npd: "НПД",
  eshn: "ЕСХН",
};

// Вид расхода, который нельзя учесть (зеркало categories.tax_kind на бэке).
const NON_DEDUCTIBLE = "Не учитываемые в целях налогообложения";

// Флаги режима: уменьшают ли расходы налог и платит ли орг НДС.
export function regimeFlags(regime) {
  return {
    reducesExpenses: ["osno", "usn_dr", "eshn"].includes(regime),
    vatPayer: regime === "osno",
  };
}

// Делит чеки на «можно/нельзя учесть» по tax_kind категории и считает
// входящий НДС (vat_20 + vat_10). catalog → карта category_id → tax_kind.
export function computeTaxAccounting(receipts, catalog) {
  const taxKindById = {};
  (catalog?.groups || []).forEach((g) =>
    (g.categories || []).forEach((c) => {
      taxKindById[c.id] = c.tax_kind;
    }),
  );
  let deductible = 0;
  let nonDeductible = 0;
  let vatSum = 0;
  let vatCount = 0;
  receipts.forEach((r) => {
    if (taxKindById[r.category_id] === NON_DEDUCTIBLE)
      nonDeductible += Number(r.amount);
    else deductible += Number(r.amount);
    const v = Number(r.vat_20 || 0) + Number(r.vat_10 || 0);
    if (v > 0) {
      vatSum += v;
      vatCount += 1;
    }
  });
  return {
    deductible,
    nonDeductible,
    vatSum,
    vatCount,
    taxTotal: deductible + nonDeductible,
  };
}
