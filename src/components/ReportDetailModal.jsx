import { useState, useEffect, useRef } from "react";
import {
  ChevronLeft,
  X,
  Undo2,
  MoreHorizontal,
  Download,
  Trash2,
} from "lucide-react";

import { C, FONT, theme } from "../lib/theme";
import { shortOrg, fmtDate, fmtDateTime, money } from "../lib/format";
import { catName, catColor } from "../lib/categories";
import { useModalA11y } from "../hooks/useModalA11y";
import { authFetch, текстОшибки } from "../lib/api";
import { BADGE, isEditable, FROZEN_HINT, canApprove } from "../lib/reports";
import { РЕЖИМЫ_ПЕРИОДА, вПериоде } from "../lib/period";
import {
  состояниеОтправки,
  отправитьВ1С,
  отменитьОтправку,
} from "../lib/export1c";
import Status1C, { Status1CLine, Status1CPlate } from "./Status1C";
// Кнопки шапки и подвала — общие с карточкой чека (1C-29 ③).
import { hbtn, iconBtn, кнопкаНиза, кнопкаДвижения } from "../lib/cardUi";
import Cancel1CSheet from "./Cancel1CSheet";

// Детали отчёта — полноэкранная карточка по образцу «Детали чека».
// ЗАЧЕМ ЭКРАН СУЩЕСТВУЕТ: без него бухгалтер одобрял вслепую — в списке видно
// только название, сумму и «N чеков», а по этому документу возмещают деньги.
// Поэтому «Одобрить»/«Отклонить» живут ТОЛЬКО здесь: чтобы принять решение,
// отчёт нужно открыть и увидеть состав. В списке остаются действия автора над
// своим документом (отправить, отозвать, исправить, удалить) — они не требуют
// изучения состава.

// Время покупки различает похожие чеки лучше всего (UX-4): у одного продавца
// за день накапливаются чеки с близкими суммами, и минуты — единственное,
// что их надёжно разводит. Показываем именно здесь, где состав проверяют.
function receiptWhen(r) {
  if (r.datetime) return fmtDateTime(r.datetime);
  return fmtDate(r.date);
}

// Имя файла берём из ответа СЕРВЕРА, а не собираем рядом: второе место, где
// строится то же имя, разошлось бы с первым молча. Заголовок виден клиенту
// только потому, что бэкенд открыл его через expose_headers — без этого здесь
// всегда было бы null, и запасное имя выглядело бы «рабочим».
function имяИзЗаголовка(res) {
  const заголовок = res.headers.get("Content-Disposition") || "";
  const совпадение = /filename="?([^";]+)"?/i.exec(заголовок);
  return совпадение ? совпадение[1] : null;
}

// Пояснения, когда действий нет. Пустой низ экрана читается как поломка.
const FOOTER_NOTE = {
  elsewhere: "Отчёт ждёт решения — одобряют и отклоняют в разделе «Отчёты»",
  noRights: "Отчёт на проверке у бухгалтера",
};

// ЕДИНСТВЕННЫЙ УЗЕЛ РЕШЕНИЯ про низ экрана. Возвращает {approve, withdraw,
// send, fix, remove, note} — что показать. Собрано в одном месте, потому что
// иначе условия «роль × статус × откуда открыли» расползаются по разметке
// и расходятся между собой.
//
// ЗАЧЕМ ДЕЙСТВИЯ АВТОРА ЗДЕСЬ, А НЕ ТОЛЬКО В СПИСКЕ: открыть отчёт, проверить
// состав и не иметь возможности отправить — тупик. Приходилось выходить назад
// в список ради кнопки, которая должна быть под рукой там, где смотрят.
// «Одобрить/Отклонить» остаются ТОЛЬКО здесь (решение по деньгам требует
// увидеть состав), а безопасные действия автора продублированы.
function footerFor({ status, role, onStatus }) {
  // onStatus не передан — отчёт открыт из карточки чека, это справка
  // «куда делся мой чек», а не рабочее место. Кнопок нет вовсе.
  if (!onStatus) {
    if (status !== "На проверке") return null;
    // Роль ещё не пришла — молчим: показать «нет прав» по незагруженным
    // данным значит соврать и потом молча переобуться.
    if (role == null) return null;
    return { note: canApprove(role) ? "elsewhere" : "noRights" };
  }
  // ⚠️ НИЗ = ДВИЖЕНИЕ ДОКУМЕНТА, УДАЛЕНИЯ ВНИЗУ НЕТ (канон карточки документа,
  // docs/RULES-FRONTEND.md, решение владельца 22.09.2026). Удаление уехало
  // в «⋯» — оно редкое и необратимое, а низ занят тем, куда документ идёт
  // дальше. Поле `remove` здесь больше не появляется ни при одном статусе.
  if (status === "Черновик") return { send: true };
  if (status === "Отклонён") return { fix: true };
  if (status === "На проверке") {
    if (role == null) return { withdraw: true }; // отзыв правом не гейтится
    // ⚠️ У ПРОВЕРЯЮЩЕГО ВНИЗУ ДВЕ КНОПКИ, А НЕ ТРИ (В5, 22.09.2026): вишнёвая
    // «Одобрить» — вперёд, белая «Отклонить» — обратный ход. «Отозвать» —
    // действие АВТОРА, а не проверяющего, и у проверяющего уходит в «⋯».
    return canApprove(role)
      ? { approve: true, reject: true }
      : { withdraw: true, note: "noRights" };
  }
  // «Одобрен» — принят к учёту. С 22.09.2026 (1C-29 ②а) у него одно действие:
  // отправка в 1С, и только тем, кому ответит бэкенд (canApprove). Что именно
  // показать — кнопку или строку состояния — решает ответ сервера, не здесь.
  // Сотруднику и пока роль грузится — низа нет, как было.
  if (status === "Одобрен") {
    return role != null && canApprove(role) ? { одинЭс: true } : null;
  }
  return null;
}

// Вид кнопок повторяет действия в списке отчётов (Btn small / Pill там):
// одно и то же действие не должно выглядеть по-разному в двух местах.
// Основа и вишнёвая — общие с src/lib/cardUi.js (канон карточки документа,
// 22.09.2026): «Отправить в 1С» и «На проверку →» — одна и та же кнопка.
const BTN_BASE = кнопкаНиза;
const BTN = {
  primary: кнопкаДвижения,
  success: {
    ...BTN_BASE,
    border: "none",
    background: theme.successFg,
    color: theme.surface,
  },
  danger: {
    ...BTN_BASE,
    border: `1px solid ${theme.errorBd}`,
    background: theme.surface,
    color: theme.errorFg,
  },
  dangerGhost: {
    ...BTN_BASE,
    border: `1px solid ${theme.errorBd}`,
    background: theme.surface,
    color: theme.errorFg,
  },
  warning: {
    ...BTN_BASE,
    border: `1px solid ${theme.warningBd}`,
    background: theme.warningBg,
    color: theme.warningFg,
  },
  neutral: {
    ...BTN_BASE,
    border: `1px solid ${theme.border}`,
    background: theme.surface,
    color: theme.slateFg,
  },
};

// Пункт меню «⋯». Красный по умолчанию: и отмена отправки, и удаление —
// опасные. Обычный цвет пункт получает подменой `color` на месте.
const ПУНКТ_МЕНЮ = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  boxSizing: "border-box",
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: "11px 12px",
  borderRadius: 8,
  font: `400 15px/1 ${FONT}`,
  color: theme.errorFg,
  textAlign: "left",
};

export default function ReportDetailModal({
  // Отчёт: из списка приходит целиком (показываем сразу, без спиннера), из
  // карточки чека — «скелетом» {id, title}: в чеке есть только report_id и
  // report_title. Всё остальное дорисовывается ответом GET /{id}.
  report,
  onClose,
  onChanged, // обновлённый отчёт → в список (из карточки чека не нужен)
  onStatus, // (id, status) → смена статуса; НЕ передан — решения тут не принимают
  onDelete, // (отчёт) → удаление; подтверждение и объяснение живут в списке
  role, // роль текущего юзера; null = ещё не загрузилась (не «нет прав»)
  reloadReceipts, // состав изменился → чек освободился/занялся
  zIndex = 120, // из карточки чека открываемся поверх неё (у неё 150)
}) {
  const [full, setFull] = useState(null); // ответ GET /{id}
  const [loadErr, setLoadErr] = useState("");
  const [busyId, setBusyId] = useState(null); // чек, который сейчас убирают
  // Отменяемое удаление: вернуть чек руками дорого (искать среди десятков
  // свободных), поэтому вместо подтверждения ДО — отмена ПОСЛЕ.
  const [undo, setUndo] = useState(null); // {receiptId, org, until}
  // T148 ②: добавление чеков ПРЯМО ИЗ ЧЕРНОВИКА. Ручка POST /{id}/receipts
  // существовала с самого начала, но из карточки отчёта её не звал никто —
  // добавить чек можно было только кружным путём через карточку каждого чека.
  // ⚠️ Пул модалка добывает САМА (GET /api/receipts/ уже отдаёт in_report и
  // user_id), а не пропсом: модалку открывают два места, и проп, который
  // один из них забудет передать, — ровно класс T118 «передали, не приняли».
  const [showAdd, setShowAdd] = useState(false);
  const [пул, setПул] = useState(null); // null = грузится
  const [addSel, setAddSel] = useState([]);
  const [периодДоб, setПериодДоб] = useState("все");
  // ⚠️ КАРТОЧКА ОДОБРЕННОГО ОТЧЁТА ПОВТОРЯЕТ КАРТОЧКУ ЧЕКА (1C-29 ③, решение
  // владельца 22.09.2026 после приёмки). Шапка: «‹ Назад», справа иконка
  // «Скачать файл для 1С» на месте «поделиться» у чека и «⋯» только с отменой
  // отправки. Состояние 1С — бейджем рядом с «Одобрен · от даты», как «ФНС»
  // у чека. Низ — одна вишнёвая «Отправить в 1С», тот же стиль, что «На
  // проверку →» у черновика: канон карточки документа (docs/RULES-FRONTEND.md
  // бэкенда, раздел «Карточка документа», решение владельца 22.09.2026) —
  // низ = движение документа, вишнёвая одна, белая только для обратного хода.
  // История: 11.09.2026 (вариант А) скачивание файла жило в меню «⋯»;
  // 22.09.2026 кнопка была вишнёвой (②а), потом белой (③), и вишнёвой снова —
  // канон карточки записан, отступление от п. 9.3 в трекере снято.
  const [menuOpen, setMenuOpen] = useState(false);
  const [скачивается, setСкачивается] = useState(false);
  const [ошибкаВыгрузки, setОшибкаВыгрузки] = useState("");
  // ⚠️ СОСТОЯНИЕ 1С — СВОЁ, А НЕ ВНУТРИ rep (класс T156). rep собирается как
  // { ...full, ...report }: проп от родителя перекрывает кэш, и положи мы
  // ответ сервера в full, старый проп из списка отчётов затёр бы его молча.
  // Поэтому отдельное состояние и перечитывание с сервера после ЛЮБОГО
  // исхода отправки и отмены — ключ ключ1С меняется, эффект идёт заново.
  const [сост1С, setСост1С] = useState(null); // ответ export-state
  const [сбой1С, setСбой1С] = useState(false);
  const [ключ1С, setКлюч1С] = useState(0);
  const [отправляется, setОтправляется] = useState(false);
  const [спроситьОтмену, setСпроситьОтмену] = useState(false);
  const [отменяется, setОтменяется] = useState(false);

  // ⚠️ ССЫЛКОЙ ЭТУ РУЧКУ НЕ ДЁРНУТЬ. Авторизация у нас в заголовке, а не
  // в куках, поэтому <a href> и window.open ушли бы БЕЗ токена и получили 401.
  // Значит только fetch с последующим Blob — и отсюда же берётся имя файла:
  // сервер присылает его в Content-Disposition, а бэкенд отдельно открывает
  // этот заголовок клиенту (expose_headers), чтобы имя не задавалось дважды.
  async function скачатьXlsx() {
    if (скачивается) return;
    setСкачивается(true);
    setОшибкаВыгрузки("");
    let url = null;
    try {
      const res = await authFetch(
        `/api/reports/${rep.id}/export.xlsx`,
        {},
        30000,
      );
      if (!res.ok) {
        const тело = await res.json().catch(() => null);
        setОшибкаВыгрузки(текстОшибки(тело, "Не удалось собрать файл"));
        return;
      }
      const blob = await res.blob();
      url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = имяИзЗаголовка(res) || `otchet-${rep.id}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      // Сеть или таймаут. Текст говорит, ЧТО делать, а не как называется сбой.
      setОшибкаВыгрузки(
        "Файл не скачался — проверьте связь и попробуйте снова",
      );
    } finally {
      // Отпускаем объект после клика: браузер к этому моменту уже начал
      // сохранение, а держать его — течь памятью на каждой выгрузке.
      if (url) URL.revokeObjectURL(url);
      setСкачивается(false);
    }
  }

  async function openAdd() {
    setShowAdd(true);
    setAddSel([]);
    setПул(null);
    try {
      const res = await authFetch("/api/receipts/");
      const все = res.ok ? await res.json() : [];
      const авторId = (full || rep).user_id;
      // Свои чеки автора отчёта, ещё не разложенные: инвариант АО-1 —
      // состав отчёта однороден по автору, бэкенд это же и проверяет.
      setПул(
        (Array.isArray(все) ? все : []).filter(
          (r) => r.user_id === авторId && !r.in_report,
        ),
      );
    } catch {
      setПул([]);
    }
  }

  async function addSelected() {
    if (!addSel.length || busyId) return;
    setBusyId(-1);
    await api(
      `/api/reports/${rep.id}/receipts`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiptIds: addSel }),
      },
      (updated) => {
        // ⚠️ НЕ applyUpdated: ручки состава отдают отчёт БЕЗ развёрнутых
        // чеков, а видимые строки считаются по кэшу full.receipts. Без
        // подмешивания добавленные чеки посчитались бы «принадлежащими
        // другому сотруднику» (hiddenCount) — ложь на ровном месте.
        // Строки у нас уже есть — из пула, второй запрос не нужен.
        const добавленные = (пул || []).filter((r) => addSel.includes(r.id));
        setFull((prev) => ({
          ...(prev || {}),
          ...updated,
          receipts: [...((prev && prev.receipts) || []), ...добавленные],
        }));
        if (onChanged) onChanged(updated);
        if (reloadReceipts) reloadReceipts();
        setShowAdd(false);
      },
    );
    if (aliveRef.current) setBusyId(null);
  }
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Загрузка деталей. Пока идёт — на экране данные из списка.
  useEffect(() => {
    queueMicrotask(async () => {
      try {
        const res = await authFetch(`/api/reports/${report.id}`);
        if (!aliveRef.current) return;
        if (!res.ok) {
          setLoadErr(
            res.status === 404
              ? "Отчёт не найден — возможно, он удалён"
              : "Не удалось загрузить состав отчёта",
          );
          return;
        }
        const data = await res.json();
        if (aliveRef.current) setFull(data);
      } catch {
        if (aliveRef.current) setLoadErr("Нет связи с сервером");
      }
    });
  }, [report.id]);

  // Автоскрытие плашки «Отменить» через 6 секунд.
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 6000);
    return () => clearTimeout(t);
  }, [undo]);

  // ⚠️ СВЕЖЕЕ ПОБЕЖДАЕТ КЭШ (T-статус, 03.09.2026). Было `full || report`:
  // после «Отправить»/«Одобрить» родитель обновлял и список, и проп report,
  // но кэш загрузки full ПЕРЕКРЫВАЛ его — статус на экране жил прежним,
  // пока не выйдешь и не зайдёшь. Ответ сервера не глотался — он доезжал
  // до пропа и проигрывал спреду. Скелет из карточки чека ({id, title})
  // безопасен: спред копирует только существующие ключи, остальное — из full.
  const rep = full ? { ...full, ...report } : report;
  const badge = BADGE[rep.status] || BADGE["Черновик"];
  const editable = isEditable(rep.status);
  const hint = FROZEN_HINT[rep.status];
  const ids = (full && full.receiptIds) || report.receiptIds || [];
  // Что уже известно. Открылись из карточки чека — до ответа GET знаем только
  // название, поэтому пустой бейдж, «от » без даты и «0,00 ₽» не рисуем:
  // выдуманные ноль и пустота хуже честного прочерка.
  const idsKnown = !!(full || report.receiptIds);
  // Развёрнутые чеки приходят только из GET /{id}; ручки состава отдают форму
  // элемента списка — с receiptIds, но без receipts. Поэтому full.receipts —
  // это КЭШ загруженных чеков, из него ничего не вычёркиваем, а видимый список
  // считаем по актуальным receiptIds. Так убранный чек пропадает сразу, а
  // «Отменить» возвращает строку без повторного запроса.
  const cached = (full && full.receipts) || [];
  const receipts = cached.filter((r) => ids.includes(r.id));
  // Часть чеков может быть не видна: A-ACL скрывает чужие (сотрудник видит
  // только свои). Молчать нельзя — иначе сумма не сойдётся с видимым списком.
  const hiddenCount = Math.max(0, ids.length - receipts.length);

  function applyUpdated(updated) {
    // updated без receipts — кэш из prev сохраняется мержем.
    setFull((prev) => ({ ...(prev || {}), ...updated }));
    if (onChanged) onChanged(updated);
    if (reloadReceipts) reloadReceipts();
  }

  async function api(path, opts, onOk) {
    try {
      const res = await authFetch(path, opts);
      if (!aliveRef.current) return;
      if (!res.ok) {
        let detail = "";
        try {
          const body = await res.json();
          if (typeof body?.detail === "string") detail = body.detail;
        } catch {
          /* пустое тело */
        }
        setLoadErr(detail || "Не удалось изменить состав отчёта");
        return;
      }
      // DELETE состава и POST состава отдают 200 С ТЕЛОМ — обновлённый отчёт
      // (в отличие от DELETE самого отчёта, который 204 без тела).
      const updated = await res.json();
      if (!aliveRef.current) return;
      setLoadErr("");
      onOk(updated);
    } catch {
      if (aliveRef.current) setLoadErr("Нет связи с сервером");
    }
  }

  async function removeReceipt(rc) {
    if (busyId) return;
    setBusyId(rc.id);
    await api(
      `/api/reports/${rep.id}/receipts/${rc.id}`,
      { method: "DELETE" },
      (updated) => {
        applyUpdated(updated);
        setUndo({ receiptId: rc.id, org: shortOrg(rc.org) });
      },
    );
    if (aliveRef.current) setBusyId(null);
  }

  async function undoRemove() {
    if (!undo || busyId) return;
    const rid = undo.receiptId;
    setBusyId(rid);
    await api(
      `/api/reports/${rep.id}/receipts`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiptIds: [rid] }),
      },
      (updated) => {
        applyUpdated(updated);
        setUndo(null);
      },
    );
    if (aliveRef.current) setBusyId(null);
  }

  const footer = footerFor({ status: rep.status, role, onStatus });

  // Состояние отправки спрашиваем ТОЛЬКО там, где есть футер «1С»: одобренный
  // отчёт, роль с правом, открыт из «Отчётов» (onStatus передан). Сотруднику
  // ручка ответила бы 403, а в справочных открытиях (из карточки чека,
  // из уведомлений) кнопок нет по правилу footerFor.
  const нужно1С = !!(footer && footer.одинЭс);
  // Что разрешил сервер — одним местом: и для кнопки, и для «⋯».
  const можноОтправить1С = нужно1С && !!сост1С && !!сост1С.можно_отправить;
  const можноОтменить1С = нужно1С && !!сост1С && !!сост1С.можно_отменить;
  // ⚠️ «⋯» — У ВСЕХ СТАТУСОВ (канон карточки документа, 22.09.2026): удаление
  // живёт здесь. Пустое меню не рисуется — на месте кнопки остаётся невидимая
  // заглушка, иначе заголовок съезжает.
  //
  // ⚠️ ЗЕРКАЛО ПРАВИЛА БЭКЕНДА, А НЕ ЗАЩИТА. Права держит ручка удаления
  // (`СОТРУДНИК_УДАЛЯЕТ` в app/routers/reports.py, REP-EXPDEL ①): сотрудник
  // сносит свой черновик и свой отклонённый, остальное — бухгалтер и админ.
  // Здесь то же самое ровно затем, чтобы не звать человека на действие,
  // которое сервер заведомо отклонит: мёртвая кнопка хуже отсутствующей.
  const живаяОтправка = нужно1С && !!сост1С && !!сост1С.живая;
  const можноУдалить =
    !!onDelete &&
    !!onStatus &&
    !живаяОтправка &&
    (role != null && canApprove(role)
      ? true
      : rep.status === "Черновик" || rep.status === "Отклонён");
  // «Отозвать» у проверяющего — редкое действие и обратный ход, ему место
  // в меню, а не в низу (В5). У автора без прав оно остаётся внизу белой.
  const можноОтозвать = !!(footer && footer.approve);
  const естьМеню = можноУдалить || можноОтменить1С || можноОтозвать;
  // У одобренного низ есть, ТОЛЬКО когда можно отправить: во всех остальных
  // состояниях статус уже в бейдже (решение владельца 22.09.2026, 1C-29 ③).
  const естьНиз = !!footer && (!footer.одинЭс || можноОтправить1С);
  const repId = rep.id;
  useEffect(() => {
    if (!нужно1С) return;
    let жив = true;
    queueMicrotask(async () => {
      const о = await состояниеОтправки(repId);
      if (!жив || !aliveRef.current) return;
      if (о.ок) {
        setСост1С(о.тело);
        setСбой1С(false);
      } else {
        setСбой1С(true);
      }
    });
    return () => {
      жив = false;
    };
  }, [нужно1С, repId, ключ1С]);

  // ⚠️ ПОСЛЕ ЛЮБОГО ИСХОДА — ПЕРЕЧИТАТЬ СОСТОЯНИЕ. Нет ответа (сеть, таймаут)
  // не значит «не отправлено»: документ мог уехать, а ответ потеряться.
  // Правду знает только сервер, поэтому текст отказа говорит смотреть строку
  // ниже, а строка перечитывается.
  const НЕТ_ОТВЕТА =
    "Сервер не ответил. Что сейчас с отправкой — в строке внизу карточки";

  async function отправить() {
    if (отправляется) return;
    setОтправляется(true);
    setОшибкаВыгрузки("");
    const о = await отправитьВ1С(rep.id);
    if (!aliveRef.current) return;
    setОтправляется(false);
    if (!о.ок) setОшибкаВыгрузки(о.текст || НЕТ_ОТВЕТА);
    setКлюч1С((к) => к + 1);
  }

  async function отменить() {
    if (отменяется) return;
    setОтменяется(true);
    setОшибкаВыгрузки("");
    const о = await отменитьОтправку(rep.id);
    if (!aliveRef.current) return;
    setОтменяется(false);
    setСпроситьОтмену(false);
    if (!о.ок) setОшибкаВыгрузки(о.текст || НЕТ_ОТВЕТА);
    setКлюч1С((к) => к + 1);
  }

  const dialogRef = useModalA11y(onClose);

  return (
    // Два слоя, как в «Деталях чека»: fixed-оверлей во весь вьюпорт + панель
    // телефонной ширины по центру. Одним слоем нельзя: position:fixed выходит
    // из потока оболочки приложения (maxWidth 480, margin auto в App.jsx),
    // и на десктопе экран растягивался на всю ширину окна, в отличие от всех
    // остальных экранов и модалок.
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex,
        background: "rgba(22,26,29,0.5)",
        display: "flex",
        alignItems: "stretch",
        justifyContent: "center",
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Отчёт «${rep.title}»`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          // relative обязателен: плашка «Чек убран · Отменить» позиционируется
          // absolute и без него уехала бы к краю окна, а не панели.
          position: "relative",
          width: "100%",
          maxWidth: 480,
          background: theme.bg,
          display: "flex",
          flexDirection: "column",
          outline: "none",
        }}
      >
        {/* ⚠️ ШАПКА — ПО ОБРАЗЦУ КАРТОЧКИ ЧЕКА (1C-29 ③, решение владельца
            22.09.2026): «‹ Назад» текстом, имя экрана по центру, справа
            иконки. Кнопки общие с чеком (src/lib/cardUi.js). Меню «Ещё»
            раскрывается относительно шапки, как у чека. */}
        <div
          style={{
            background: theme.surface,
            borderBottom: `1px solid ${theme.border}`,
            padding: "calc(env(safe-area-inset-top) + 6px) 8px 6px",
            display: "flex",
            alignItems: "center",
            minHeight: 52,
            flexShrink: 0,
            position: "relative",
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
              minWidth: 0,
              textAlign: "center",
              font: `600 17px/1 ${FONT}`,
              color: theme.fg1,
            }}
          >
            Отчёт
          </div>
          {/* ⚠️ ИКОНКИ — ТОЛЬКО ТЕМ, КОМУ РУЧКА ОТВЕТИТ. Гейт тот же, что
              у «Одобрить/Отклонить» (canApprove), и он совпадает с гейтом
              бэкенда: сотрудник получил бы 403 — мёртвый жест. role == null —
              роль ещё грузится, рисовать рано. «Скачать файл для 1С» стоит
              там же и тем же стилем, что «поделиться» у чека. «⋯» — только
              когда в меню есть что показать (отмена отправки): мёртвых меню
              нет. Пустое место занимает невидимая заглушка размером с иконку:
              у чека справа всегда две иконки, и они держат имя экрана по
              центру; без заглушек «Отчёт» съезжал вправо. */}
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            {role != null && canApprove(role) ? (
              <button
                type="button"
                onClick={скачатьXlsx}
                disabled={скачивается}
                aria-label="Скачать файл для 1С"
                title="Скачать файл для 1С"
                style={{
                  ...iconBtn,
                  color: скачивается ? theme.fg3 : theme.fg1,
                }}
              >
                <Download size={21} />
              </button>
            ) : (
              <span
                aria-hidden="true"
                style={{ ...iconBtn, visibility: "hidden" }}
              />
            )}
            {естьМеню ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((v) => !v);
                }}
                aria-label="Ещё"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                style={iconBtn}
              >
                <MoreHorizontal size={22} />
              </button>
            ) : (
              <span
                aria-hidden="true"
                style={{ ...iconBtn, visibility: "hidden" }}
              />
            )}
          </div>
          {menuOpen && естьМеню && (
            <>
              {/* Подложка ловит тап мимо меню. Слой ниже самого меню на один
                  уровень — правило слоёв: число берётся по РОЛИ, а не на глаз. */}
              <div
                onClick={() => setMenuOpen(false)}
                style={{ position: "fixed", inset: 0, zIndex: zIndex + 1 }}
              />
              <div
                role="menu"
                style={{
                  position: "absolute",
                  top: 54,
                  right: 10,
                  background: theme.surface,
                  borderRadius: 12,
                  boxShadow: "0 8px 30px rgba(17,19,24,.18)",
                  border: `1px solid ${theme.border}`,
                  minWidth: 200,
                  padding: 6,
                  zIndex: zIndex + 2,
                  overflow: "hidden",
                }}
              >
                {/* Порядок: сперва обратимое, опасное — вниз. Отмена отправки
                    и удаление красным, отзыв обычным цветом. */}
                {можноОтозвать && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onStatus(rep.id, "Черновик");
                    }}
                    style={{ ...ПУНКТ_МЕНЮ, color: theme.fg1 }}
                  >
                    <Undo2 size={18} />
                    Отозвать с проверки
                  </button>
                )}
                {можноОтменить1С && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      setСпроситьОтмену(true);
                    }}
                    style={ПУНКТ_МЕНЮ}
                  >
                    <Undo2 size={18} />
                    Отменить отправку в 1С
                  </button>
                )}
                {можноУдалить && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onDelete(rep);
                    }}
                    style={ПУНКТ_МЕНЮ}
                  >
                    <Trash2 size={18} />
                    Удалить отчёт
                  </button>
                )}
              </div>
            </>
          )}
        </div>
        {/* ⚠️ ОТКАЗ ВЫГРУЗКИ — НА ЭКРАНЕ, А НЕ СИСТЕМНЫМ ОКНОМ (Р-ОТКАЗЫ).
            Тот же приём, что у «Поделиться» в карточке чека. Гаснет при
            следующей попытке: старая ошибка рядом с новой кнопкой врёт
            про состояние. */}
        {ошибкаВыгрузки && (
          <div
            role="alert"
            style={{
              margin: "8px 16px 0",
              padding: "8px 10px",
              borderRadius: 8,
              background: theme.errorBg,
              border: `1px solid ${theme.errorBd}`,
              font: `400 12px/1.4 ${FONT}`,
              color: theme.errorFg,
            }}
          >
            {ошибкаВыгрузки}
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px 90px" }}>
          {/* заголовок + статус + итог */}
          <div
            style={{
              background: theme.surface,
              borderRadius: 12,
              padding: "16px",
              boxShadow: "0 1px 3px rgba(17,19,24,.08)",
            }}
          >
            <div style={{ font: `700 19px/1.3 ${FONT}`, color: C.dark }}>
              {rep.title}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginTop: 8,
                flexWrap: "wrap",
              }}
            >
              {rep.status && (
                <span
                  style={{
                    font: `600 12px/1 ${FONT}`,
                    padding: "5px 10px",
                    borderRadius: 999,
                    background: badge.bg,
                    color: badge.color,
                  }}
                >
                  {rep.status}
                </span>
              )}
              {rep.created && (
                <span style={{ font: `400 13px/1 ${FONT}`, color: theme.fg2 }}>
                  от {fmtDate(rep.created)}
                </span>
              )}
              {/* 1С — рядом с «Одобрен · от даты», тем же стилем, что «ФНС»
                  у чека (1C-29 ③). */}
              {нужно1С && <Status1C состояние={сост1С} />}
            </div>
            {нужно1С && (
              <Status1CLine
                состояние={сост1С}
                сбой={сбой1С}
                onRetry={() => setКлюч1С((к) => к + 1)}
              />
            )}

            {/* ⚠️ ПРИЧИНА ОТКАЗА — В САМОМ ОТЧЁТЕ, А НЕ ТОЛЬКО В ПИСЬМЕ (T159).
                Письмо человек удалит или не увидит, а вопрос «что было не так»
                вернётся через месяц, когда он откроет отчёт. Показываем только
                у отклонённого: у остальных статусов поля нет. */}
            {rep.status === "Отклонён" && rep.reject_reason && (
              <div
                style={{
                  marginTop: 10,
                  font: `400 13px/1.45 ${FONT}`,
                  color: "#B91C1C",
                  background: "#FEF2F2",
                  border: "1px solid #FECACA",
                  borderRadius: 8,
                  padding: "10px 12px",
                }}
              >
                <b>Причина отклонения:</b> {rep.reject_reason}
              </div>
            )}

            {/* Почему в этом статусе ничего нельзя — вместо мёртвых кнопок */}
            {hint && (
              <div
                style={{
                  marginTop: 10,
                  font: `400 12px/1.45 ${FONT}`,
                  color: "#B45309",
                  background: "#FFFBEB",
                  border: "1px solid #FDE68A",
                  borderRadius: 8,
                  padding: "8px 10px",
                }}
              >
                {hint}
                {нужно1С && <Status1CPlate состояние={сост1С} />}
              </div>
            )}

            {/* Сумма — из total (его считает бэк по составу), а НЕ по видимым
              чекам: сотруднику часть состава может быть не видна. */}
            <div
              style={{
                marginTop: 14,
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
              }}
            >
              <span style={{ font: `400 13px/1 ${FONT}`, color: theme.fg2 }}>
                Итого по отчёту
              </span>
              <span
                style={{
                  font: `700 22px/1 ${FONT}`,
                  color: C.dark,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {rep.total != null ? money(rep.total) : "—"}
              </span>
            </div>
          </div>

          {loadErr && (
            <div
              style={{
                marginTop: 12,
                font: `500 13px/1.4 ${FONT}`,
                color: "#B91C1C",
                background: "#FEF2F2",
                border: "1px solid #FECACA",
                borderRadius: 8,
                padding: "10px 12px",
              }}
            >
              {loadErr}
            </div>
          )}

          {/* состав */}
          <div
            style={{
              font: `600 11px/1 ${FONT}`,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: theme.fg2,
              margin: "20px 2px 8px",
            }}
          >
            Чеки{idsKnown ? ` · ${ids.length}` : ""}
          </div>

          {!full && !loadErr && (
            <div
              style={{
                font: `400 13px/1 ${FONT}`,
                color: theme.fg3,
                padding: "14px 2px",
              }}
            >
              Загружаем состав…
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {receipts.map((rc) => (
              <div
                key={rc.id}
                style={{
                  background: theme.surface,
                  borderRadius: 12,
                  boxShadow: "0 1px 3px rgba(17,19,24,.06)",
                  padding: "12px 14px",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    flexShrink: 0,
                    background: catColor(catName(rc)),
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      font: `600 14px/1.25 ${FONT}`,
                      color: C.dark,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {shortOrg(rc.org)}
                  </div>
                  <div
                    style={{
                      font: `400 12px/1.3 ${FONT}`,
                      color: theme.fg2,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {receiptWhen(rc)} · {catName(rc)}
                  </div>
                </div>
                <span
                  style={{
                    font: `700 14px/1 ${FONT}`,
                    color: C.dark,
                    fontVariantNumeric: "tabular-nums",
                    whiteSpace: "nowrap",
                  }}
                >
                  {money(rc.amount)}
                </span>
                {/* Убрать чек можно только там, где бэк разрешает менять состав */}
                {editable && (
                  <button
                    onClick={() => removeReceipt(rc)}
                    disabled={busyId === rc.id}
                    aria-label={`Убрать чек ${shortOrg(rc.org)} из отчёта`}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: busyId === rc.id ? "default" : "pointer",
                      color: theme.fg3,
                      padding: 4,
                      opacity: busyId === rc.id ? 0.4 : 1,
                      display: "flex",
                      flexShrink: 0,
                    }}
                  >
                    <X size={18} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Часть состава скрыта ролевым фильтром — говорим об этом прямо,
            иначе «Итого» не сойдётся с видимыми строками. */}
          {hiddenCount > 0 && (
            <div
              style={{
                marginTop: 10,
                font: `400 12px/1.45 ${FONT}`,
                color: theme.fg2,
                background: theme.surfaceSunk,
                borderRadius: 8,
                padding: "10px 12px",
              }}
            >
              Ещё {hiddenCount} чек(ов) в отчёте принадлежат другому сотруднику
              и вам недоступны. Сумма выше — по всему составу.
            </div>
          )}

          {full && receipts.length === 0 && hiddenCount === 0 && (
            <div
              style={{
                font: `400 13px/1.4 ${FONT}`,
                color: theme.fg3,
                padding: "14px 2px",
              }}
            >
              {/* ⚠️ Текст поправлен вместе с T148 ②: прежний отправлял в
                  карточку чека, потому что другого пути НЕ БЫЛО. */}
              В отчёте пока нет чеков — добавьте кнопкой ниже
            </div>
          )}

          {/* T148 ②: черновик правится здесь же, а не пересозданием отчёта.
              Кнопка только там, где бэк разрешает менять состав. */}
          {editable && full && (
            <button
              type="button"
              onClick={openAdd}
              style={{
                width: "100%",
                boxSizing: "border-box",
                marginTop: 12,
                padding: "11px 12px",
                borderRadius: 10,
                border: `1px dashed ${theme.border}`,
                background: theme.surfaceSunk,
                color: theme.fg1,
                font: `500 13px/1.3 ${FONT}`,
                cursor: "pointer",
              }}
            >
              + Добавить чеки
            </button>
          )}
        </div>

        {/* T148 ②: шторка добавления чеков в черновик. Поверх панели,
            тем же слоем-приёмом, что плашка отмены ниже. */}
        {showAdd && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: theme.bg,
              zIndex: 5,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "14px 16px 10px",
              }}
            >
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                aria-label="Назад к отчёту"
                style={{
                  background: "none",
                  border: "none",
                  padding: 4,
                  cursor: "pointer",
                  display: "flex",
                  color: theme.fg1,
                }}
              >
                <ChevronLeft size={22} />
              </button>
              <span style={{ font: `600 15px/1.2 ${FONT}`, color: C.dark }}>
                Добавить чеки
              </span>
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: "0 16px 16px" }}>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginBottom: 10,
                }}
              >
                {РЕЖИМЫ_ПЕРИОДА.map(([v, l]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setПериодДоб(v)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 999,
                      border: `1px solid ${
                        периодДоб === v ? theme.cherry : theme.border
                      }`,
                      background:
                        периодДоб === v ? theme.cherryTint : theme.surface,
                      color: периодДоб === v ? theme.cherry : theme.fg2,
                      font: `500 12px/1.2 ${FONT}`,
                      cursor: "pointer",
                    }}
                  >
                    {l}
                  </button>
                ))}
              </div>
              {пул === null && (
                <div
                  style={{
                    font: `400 13px/1.4 ${FONT}`,
                    color: theme.fg3,
                    padding: "10px 2px",
                  }}
                >
                  Загружаем свободные чеки…
                </div>
              )}
              {пул !== null &&
                (() => {
                  const видимые = пул.filter((r) =>
                    вПериоде(r.date, периодДоб),
                  );
                  if (!пул.length)
                    return (
                      <div
                        style={{
                          font: `400 13px/1.4 ${FONT}`,
                          color: theme.fg3,
                          padding: "10px 2px",
                        }}
                      >
                        Свободных чеков нет: все чеки автора уже разложены по
                        отчётам
                      </div>
                    );
                  const всеВыбраны =
                    видимые.length > 0 &&
                    видимые.every((r) => addSel.includes(r.id));
                  return (
                    <>
                      {видимые.length > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            setAddSel((prev) =>
                              всеВыбраны
                                ? prev.filter(
                                    (id) => !видимые.some((r) => r.id === id),
                                  )
                                : [
                                    ...prev,
                                    ...видимые
                                      .map((r) => r.id)
                                      .filter((id) => !prev.includes(id)),
                                  ],
                            )
                          }
                          style={{
                            width: "100%",
                            boxSizing: "border-box",
                            textAlign: "left",
                            padding: "9px 12px",
                            marginBottom: 10,
                            borderRadius: 8,
                            /* T148-акцент: как в шторке создания — язык
                               активной фишки периода, заливка не тронута */
                            border: `1px solid ${theme.cherry}`,
                            background: theme.cherryTint,
                            color: theme.cherry,
                            font: `600 13px/1.3 ${FONT}`,
                            cursor: "pointer",
                          }}
                        >
                          {всеВыбраны
                            ? `Снять все за период (${видимые.length})`
                            : `Выбрать все за период: ${
                                видимые.length
                              } · ${money(
                                видимые.reduce(
                                  (s, r) => s + Number(r.amount),
                                  0,
                                ),
                              )}`}
                        </button>
                      )}
                      {видимые.map((r) => {
                        const sel = addSel.includes(r.id);
                        return (
                          <div
                            key={r.id}
                            onClick={() =>
                              setAddSel((prev) =>
                                sel
                                  ? prev.filter((id) => id !== r.id)
                                  : [...prev, r.id],
                              )
                            }
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              padding: "10px 12px",
                              marginBottom: 8,
                              background: theme.surface,
                              border: `1px solid ${
                                sel ? theme.cherry : theme.border
                              }`,
                              borderRadius: 10,
                              cursor: "pointer",
                            }}
                          >
                            <div
                              style={{
                                width: 16,
                                height: 16,
                                border: `1.5px solid ${
                                  sel ? theme.cherry : theme.border
                                }`,
                                background: sel ? theme.cherry : "transparent",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: theme.surface,
                                fontSize: 10,
                                flexShrink: 0,
                                borderRadius: 3,
                              }}
                            >
                              {sel && "✓"}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div
                                style={{
                                  font: `500 13px/1.3 ${FONT}`,
                                  color: C.dark,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {shortOrg(r.org)}
                              </div>
                              <div
                                style={{
                                  font: `400 12px/1.3 ${FONT}`,
                                  color: theme.fg2,
                                }}
                              >
                                {fmtDate(r.date)} · {catName(r)}
                              </div>
                            </div>
                            <span
                              style={{
                                font: `600 13px/1.2 ${FONT}`,
                                color: C.dark,
                                fontVariantNumeric: "tabular-nums",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {money(r.amount)}
                            </span>
                          </div>
                        );
                      })}
                    </>
                  );
                })()}
              {loadErr && (
                <div
                  role="alert"
                  style={{
                    background: theme.errorBg,
                    color: theme.errorFg,
                    border: `1px solid ${theme.errorBd}`,
                    borderRadius: 8,
                    padding: "10px 12px",
                    font: `400 13px/1.4 ${FONT}`,
                  }}
                >
                  {loadErr}
                </div>
              )}
            </div>
            <div
              style={{
                padding: "10px 16px calc(env(safe-area-inset-bottom) + 12px)",
                borderTop: `1px solid ${theme.border}`,
                background: theme.surface,
              }}
            >
              <button
                type="button"
                onClick={addSelected}
                disabled={!addSel.length || busyId === -1}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: 13,
                  background: addSel.length ? theme.cherry : theme.border,
                  color: "#fff",
                  border: "none",
                  borderRadius: 10,
                  font: `600 15px/1.2 ${FONT}`,
                  cursor: addSel.length ? "pointer" : "default",
                }}
              >
                {busyId === -1 ? "Добавляем…" : `Добавить (${addSel.length})`}
              </button>
            </div>
          </div>
        )}

        {/* Плашка отмены: вернуть чек руками дорого (искать среди свободных),
          поэтому даём отмену сразу после действия. */}
        {undo && (
          <div
            style={{
              position: "absolute",
              left: 16,
              right: 16,
              bottom: "calc(env(safe-area-inset-bottom) + 84px)",
              background: C.dark,
              color: theme.surface,
              borderRadius: 10,
              padding: "12px 14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              boxShadow: "0 6px 20px rgba(17,19,24,.25)",
              zIndex: 5,
            }}
          >
            <span style={{ font: `500 13px/1.3 ${FONT}` }}>
              Чек убран{undo.org ? ` · ${undo.org}` : ""}
            </span>
            <button
              onClick={undoRemove}
              disabled={busyId != null}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "none",
                border: "none",
                color: "#FFD9DA",
                font: `600 13px/1 ${FONT}`,
                cursor: busyId != null ? "default" : "pointer",
                padding: 0,
              }}
            >
              <Undo2 size={16} />
              Отменить
            </button>
          </div>
        )}

        {спроситьОтмену && (
          <Cancel1CSheet
            документ={сост1С && сост1С.живая ? сост1С.живая.документ : null}
            занято={отменяется}
            onKeep={() => setСпроситьОтмену(false)}
            onCancel={отменить}
            кнопки={{ оставить: BTN.neutral, отменить: BTN.danger }}
          />
        )}

        {/* Низ экрана: действия и/или объяснение. Что именно — решает
          footerFor, здесь только отрисовка. Кнопки повторяют вид тех же
          действий в списке отчётов, чтобы одно и то же не выглядело
          по-разному в двух местах. */}
        {естьНиз && (
          <div
            style={{
              flexShrink: 0,
              background: theme.surface,
              borderTop: `1px solid ${theme.border}`,
              padding: "12px 16px calc(12px + env(safe-area-inset-bottom))",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {/* ⚠️ ОДОБРЕННЫЙ: ОДНА ВИШНЁВАЯ «ОТПРАВИТЬ В 1С» — движение документа
                в следующее состояние, тот же стиль, что «На проверку →»
                у черновика (канон карточки документа, решение владельца
                22.09.2026). Только при можно_отправить; во время отправки —
                она же, неактивная. Обратного хода у одобренного внизу нет. */}
            {footer.одинЭс && можноОтправить1С && (
              <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                <button
                  type="button"
                  onClick={отправить}
                  disabled={отправляется}
                  style={{
                    ...кнопкаДвижения,
                    cursor: отправляется ? "default" : "pointer",
                  }}
                >
                  {отправляется ? "Отправляется в 1С…" : "Отправить в 1С"}
                </button>
              </div>
            )}
            {/* ⚠️ НИЗ ПО КАНОНУ КАРТОЧКИ ДОКУМЕНТА (решение владельца
                22.09.2026, В5): ОДНА ВИШНЁВАЯ — движение вперёд, белая рядом —
                только обратный ход. До этого захода «На проверке» показывал три
                цветные кнопки: зелёную «Одобрить», красную «Отклонить»,
                янтарную «Отозвать» — каждая своим цветом, и человеку
                приходилось читать цвет как значение. Удаления внизу нет ни
                при одном статусе: оно в «⋯». */}
            {(footer.approve ||
              footer.reject ||
              footer.withdraw ||
              footer.send ||
              footer.fix) && (
              <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                {/* ⚠️ «ИСПРАВИТЬ» ВИШНЁВАЯ — ПРАВКА ПО ПРИЁМКЕ 23.09.2026.
                    У отклонённого отчёта это и есть движение вперёд: вернуть
                    в черновик, починить и отправить снова. Белой она читалась
                    как второстепенная, и главного действия у экрана не было
                    видно вовсе. Канон карточки документа: одна вишнёвая —
                    следующее состояние. */}
                {footer.fix && (
                  <button
                    onClick={() => onStatus(rep.id, "Черновик")}
                    style={BTN.primary}
                  >
                    Исправить
                  </button>
                )}
                {footer.reject && (
                  <button
                    onClick={() => onStatus(rep.id, "Отклонён")}
                    style={BTN.neutral}
                  >
                    Отклонить
                  </button>
                )}
                {footer.withdraw && (
                  <button
                    onClick={() => onStatus(rep.id, "Черновик")}
                    style={BTN.neutral}
                  >
                    Отозвать
                  </button>
                )}
                {footer.send && (
                  <button
                    onClick={() => onStatus(rep.id, "На проверке")}
                    style={BTN.primary}
                  >
                    На проверку →
                  </button>
                )}
                {footer.approve && (
                  <button
                    onClick={() => onStatus(rep.id, "Одобрен")}
                    style={BTN.primary}
                  >
                    ✓ Одобрить
                  </button>
                )}
              </div>
            )}
            {FOOTER_NOTE[footer.note] && (
              <div
                style={{
                  font: `400 13px/1.4 ${FONT}`,
                  color: theme.fg2,
                  textAlign: "center",
                }}
              >
                {FOOTER_NOTE[footer.note]}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
