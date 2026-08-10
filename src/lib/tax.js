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

/** НДС одного чека, в рублях.
 *
 * СУММИРУЕМ ВСЕ СТАВКИ ИЗ `vat_breakdown` БЕЗ СПИСКА — и это не стилистика,
 * а причина, по которой мы здесь. Раньше стояло `vat_20 + vat_10`, то есть
 * список из двух ставок в коде фронта. С 2026 года действует 22%, и блок
 * «Входящий НДС» показывал МЕНЬШЕ ТРЕТИ настоящей суммы: замер по проду
 * 10.08.2026 — показывал 1 385,62 ₽ при верных 4 702,11 ₽, занижение
 * 3 316,49 ₽ (70,5%). Цифру переносят в декларацию.
 * Любой список ставок здесь устареет на следующей их смене ровно так же,
 * поэтому его нет: берём всё, что в разбивке лежит.
 *
 * ЧТО В РАЗБИВКЕ. Её собирает бэкенд по тегу 1199 ФФД и кладёт ТОЛЬКО
 * ставки с фактическим налогом: 0% и «без НДС» не попадают, расчётные
 * (20/120, 10/110, 5/105, 7/107, 22/122) сведены к своей базовой ставке.
 * Значит фильтровать здесь нечего — сложить и всё.
 *
 * ФОТО-ЧЕКИ: РАЗБИВКИ НЕТ, И ЭТО НЕ НЕДОДЕЛКА. Она строится из кодов ставок
 * ФНС (`items[].nds`), а распознавание фото таких кодов не даёт — OCR видит
 * суммы, а не коды. Поэтому у фото-чеков бэкенд заполняет одно общее поле
 * `nds`, и берём его — иначе после перехода на разбивку фото-чеки перестали
 * бы давать НДС совсем, то есть починка одного занижения создала бы другое.
 *
 * ПОРЯДОК ВАЖЕН: если есть разбивка — берём ТОЛЬКО её. `nds` у чеков ФНС
 * тоже бывает заполнен, и сложение дало бы двойной счёт — ошибку той же
 * природы, что чиним, только в другую сторону.
 */
export function receiptVat(r) {
  const bd = r?.vat_breakdown;
  if (bd && typeof bd === "object") {
    const сумма = Object.values(bd).reduce((a, v) => a + (Number(v) || 0), 0);
    if (сумма > 0) return сумма;
  }
  return Number(r?.nds) || 0;
}

// Делит чеки на «можно/нельзя учесть» по tax_kind категории и считает
// входящий НДС (см. receiptVat). catalog → карта category_id → tax_kind.
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
    const v = receiptVat(r);
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
