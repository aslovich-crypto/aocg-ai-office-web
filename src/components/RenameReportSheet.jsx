// ⚠️ ПЕРЕИМЕНОВАНИЕ ОТЧЁТА (REP-RENAME, решение владельца 23.09.2026).
// До этого захода название отчёта писалось ОДИН раз, при создании: опечатку
// в имени исправить было нечем ни ручкой, ни экраном (замер 21.09.2026).
//
// ⚠️ ФОРМА ОБЩАЯ С ОСТАЛЬНЫМИ ВОПРОСАМИ — `AskSheet`: положение, подложка,
// слой, безопасная зона, левая «Отмена». Своё здесь только поле и правило
// «пустое имя не сохраняем».
//
// ⚠️ ПРОВЕРКА ПУСТОТЫ ЗДЕСЬ — НЕ ЗАЩИТА, А ВЕЖЛИВОСТЬ. Сервер ответит 422
// с тем же смыслом; кнопка гаснет затем, чтобы человек узнал об этом ДО
// нажатия, а не отказом после.
import { useState } from "react";
import AskSheet from "./AskSheet";
import { шторкаДвижения } from "../lib/cardUi";
import { theme, FONT } from "../lib/theme";

export default function RenameReportSheet({
  отчёт,
  занято,
  onKeep,
  onConfirm,
}) {
  const [имя, setИмя] = useState((отчёт && отчёт.title) || "");
  const пусто = !имя.trim();
  return (
    <AskSheet
      заголовок="Переименовать отчёт"
      занято={занято}
      нельзя={пусто}
      onKeep={onKeep}
      onConfirm={() => onConfirm(имя.trim())}
      стильДействия={шторкаДвижения}
      подписьДействия="Сохранить"
      подписьЗанято="Сохраняем…"
    >
      <input
        value={имя}
        onChange={(e) => setИмя(e.target.value)}
        autoFocus
        aria-label="Название отчёта"
        maxLength={255}
        style={{
          width: "100%",
          boxSizing: "border-box",
          borderRadius: 12,
          border: `1px solid ${theme.border}`,
          background: theme.surfaceSunk,
          padding: "12px 14px",
          // 16px — иначе Safari зумит поле при фокусе и запоминает масштаб.
          font: `400 16px/1.4 ${FONT}`,
          color: theme.fg1,
        }}
      />
    </AskSheet>
  );
}
