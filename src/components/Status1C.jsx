// Бейджи «что с отправкой в 1С» в шапке одобренного отчёта (1C-29 ③,
// решение владельца 22.09.2026: карточка отчёта повторяет карточку чека).
// Стиль — та же пилюля, что «ФНС» у чека (src/lib/cardUi.js). Текст решает
// бейджи1С (src/lib/export1c.js), здесь только вид.
//
// ⚠️ ТРИ МЕСТА, ПОТОМУ И ТРИ ЭКСПОРТА: пилюли встают ВНУТРИ ряда «Одобрен ·
// от даты»; строка — под этим рядом; строка плашки — в жёлтой плашке
// карточки. Карточка ставит каждый кусок на своё место сама.
//
// ⚠️ ЗАГРУЗКА И СБОЙ. Пока состояние не пришло — бейджей нет (и кнопки
// «Отправить» тоже: её показывают только по ответу сервера). Не загрузилось —
// общая разметка LoadFailure с повтором (T171): пустое место читалось бы как
// «не отправлен», и бухгалтер отправил бы второй раз.
//
// data-1c — метки для прибора npm run v1s: он читает бейджи ТОЛЬКО внутри
// диалога отчёта и по этим меткам, а не по тексту со всей страницы.
import { BadgeCheck, TriangleAlert } from "lucide-react";
import { theme, FONT } from "../lib/theme";
import { пилюля } from "../lib/cardUi";
import { бейджи1С } from "../lib/export1c";
import LoadFailure from "./LoadFailure";

const ЗНАЧКИ = { галочка: BadgeCheck, внимание: TriangleAlert };

export default function Status1C({ состояние }) {
  const б = бейджи1С(состояние);
  if (!б) return null;
  return б.пилюли.map((п) => {
    const Icon = ЗНАЧКИ[п.значок];
    return (
      <span key={п.текст} data-1c="пилюля" style={пилюля(п.тон)}>
        {Icon && <Icon size={14} style={{ transform: "translateY(.5px)" }} />}
        <span>{п.текст}</span>
      </span>
    );
  });
}

// Под рядом бейджей: последняя неудача, счёт по умолчанию — или сбой загрузки.
export function Status1CLine({ состояние, сбой, onRetry }) {
  if (сбой) {
    return (
      <div style={{ marginTop: 10 }}>
        <LoadFailure что="состояние отправки в 1С" onRetry={onRetry} />
      </div>
    );
  }
  const б = бейджи1С(состояние);
  if (!б || !б.строка) return null;
  return (
    <div
      data-1c="строка"
      style={{ marginTop: 6, font: `400 12px/1.4 ${FONT}`, color: theme.fg2 }}
    >
      {б.строка}
    </div>
  );
}

// Вторая строка жёлтой плашки карточки — только у прерванной отправки.
export function Status1CPlate({ состояние }) {
  const б = бейджи1С(состояние);
  if (!б || !б.плашка) return null;
  return (
    <div data-1c="плашка" style={{ marginTop: 4 }}>
      {б.плашка}
    </div>
  );
}
