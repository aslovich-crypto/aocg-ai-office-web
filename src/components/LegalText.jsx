// Показ юридического документа (согласие, политика) — markdown как есть.
//
// ПОЧЕМУ ПОЛНЫЙ ТЕКСТ, А НЕ ВЫЖИМКА. Согласие принимается на ВЕСЬ документ:
// человек соглашается ровно с тем, что сохранится в журнал. Выжимка означала
// бы, что показали одно, а зафиксировали другое, — та самая болезнь, из-за
// которой в S-34 разъехались две редакции.
//
// ПОЧЕМУ MARKDOWN. Редакция юриста (2.0) — это 109 и 185 строк с заголовками,
// списками и таблицами правовых оснований. В простом тексте таблицы приезжают
// палками и дефисами; читать документ, который предъявляют в РКН, в таком виде
// нельзя. react-markdown уже предусмотрен правилами репозитория для справки —
// переиспользуем готовый паттерн, а не заводим свой разбор.
//
// ТАБЛИЦЫ ПРОКРУЧИВАЮТСЯ ВНУТРИ СЕБЯ. На 375px таблица из четырёх колонок шире
// экрана; без своего контейнера прокрутки она растянула бы всю шторку, и уехал
// бы весь документ, а не одна таблица.
//
// REMARK-GFM ОБЯЗАТЕЛЕН, БЕЗ НЕГО ТАБЛИЦ НЕТ. Голый react-markdown понимает
// только CommonMark, где таблиц не существует: 24 табличные строки обоих
// документов выходили палками и дефисами прямо в шторке. Первый прогон стенда
// показал 0 таблиц — дефект поймала проверка, а не глаз.
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { C, FONT, theme } from "../lib/theme";

const плагины = [remarkGfm];

const ЗАГОЛОВОК = { fontFamily: FONT, color: C.dark, fontWeight: 700 };

// Один общий вид для всех документов: они читаются подряд, разнобой мешал бы.
const компоненты = {
  h1: (p) => (
    <div style={{ ...ЗАГОЛОВОК, fontSize: 16, margin: "0 0 10px" }} {...p} />
  ),
  h2: (p) => (
    <div style={{ ...ЗАГОЛОВОК, fontSize: 14, margin: "18px 0 8px" }} {...p} />
  ),
  h3: (p) => (
    <div style={{ ...ЗАГОЛОВОК, fontSize: 13, margin: "14px 0 6px" }} {...p} />
  ),
  p: (p) => <p style={{ margin: "0 0 10px" }} {...p} />,
  ul: (p) => <ul style={{ margin: "0 0 10px", paddingLeft: 18 }} {...p} />,
  ol: (p) => <ol style={{ margin: "0 0 10px", paddingLeft: 18 }} {...p} />,
  li: (p) => <li style={{ margin: "0 0 4px" }} {...p} />,
  strong: (p) => <strong style={{ fontWeight: 600, color: C.dark }} {...p} />,
  em: (p) => <em style={{ color: theme.fg2 }} {...p} />,
  hr: () => (
    <hr
      style={{
        border: "none",
        borderTop: `1px solid ${theme.border}`,
        margin: "16px 0",
      }}
    />
  ),
  a: (p) => <a style={{ color: theme.cherry }} {...p} />,
  // Таблица правовых оснований: своя прокрутка, чтобы не растягивать шторку.
  table: (p) => (
    <div style={{ overflowX: "auto", margin: "0 0 12px" }}>
      <table
        style={{ borderCollapse: "collapse", fontSize: 12, minWidth: 520 }}
        {...p}
      />
    </div>
  ),
  th: (p) => (
    <th
      style={{
        border: `1px solid ${theme.border}`,
        padding: "6px 8px",
        textAlign: "left",
        fontWeight: 600,
        background: theme.surfaceSunk,
        color: C.dark,
      }}
      {...p}
    />
  ),
  td: (p) => (
    <td
      style={{
        border: `1px solid ${theme.border}`,
        padding: "6px 8px",
        verticalAlign: "top",
        color: C.dark,
      }}
      {...p}
    />
  ),
};

export default function LegalText({ text }) {
  if (!text) return null;
  return (
    <div
      style={{
        fontFamily: FONT,
        fontSize: 13,
        color: C.dark,
        lineHeight: 1.55,
      }}
    >
      <Markdown components={компоненты} remarkPlugins={плагины}>
        {text}
      </Markdown>
    </div>
  );
}
