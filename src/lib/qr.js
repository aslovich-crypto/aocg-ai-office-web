// Кодек QR-строки фискального чека: разбор (скан) и обратная сборка (ручной
// ввод реквизитов). Чистые функции без состояния — вынесены из App.jsx, чтобы
// их могли использовать и монолит, и вынесенный ScanReceiptModal.

export function parseQRString(qr) {
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
export function buildQRString({ date, time, amount, fn, fd, fpd, opType }) {
  const t = `${(date || "").replace(/-/g, "")}T${(time || "").replace(
    ":",
    "",
  )}`;
  const s = Number(String(amount).replace(",", ".")).toFixed(2);
  return `t=${t}&s=${s}&fn=${fn}&i=${fd}&fp=${fpd}&n=${opType}`;
}
