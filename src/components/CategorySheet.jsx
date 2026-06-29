import { useState, useEffect } from "react";
import { C, FONT } from "../lib/theme";
import { groupColor } from "../lib/categories";
import { useModalA11y } from "../hooks/useModalA11y";

// Нижняя шторка выбора статьи расхода: поиск + группы каталога. Возвращает имя
// статьи через onPick(name). Вынесена из App.jsx — переиспользуется в карточке
// чека (ReceiptDetailModal) и в форме добавления чека.
export default function CategorySheet({ catalog, selected, onPick, onClose }) {
  const [shown, setShown] = useState(false);
  const [q, setQ] = useState("");
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
  const close = () => {
    setShown(false);
    setTimeout(onClose, 220);
  };
  const pick = (name) => {
    onPick(name);
    close();
  };
  const ql = q.trim().toLowerCase();
  const visGroups = (catalog?.groups || [])
    .map((g) => ({
      ...g,
      cats: (g.categories || []).filter(
        (c) =>
          c.is_visible !== false && (!ql || c.name.toLowerCase().includes(ql)),
      ),
    }))
    .filter((g) => g.cats.length > 0);
  // UX-3: быстрый вход к статье «Не учитываемые в налоговом учёте» (расход не
  // уменьшает налог). Ищем по налоговому смыслу (tax_kind), не по имени/id —
  // устойчиво к переименованию. Прячем при активном поиске (поиск и так её выводит).
  const SPECIAL_TK = "Не учитываемые в целях налогообложения";
  const specialGroup =
    ql || !catalog?.groups
      ? null
      : catalog.groups.find((g) =>
          (g.categories || []).some(
            (c) => c.tax_kind === SPECIAL_TK && c.is_visible !== false,
          ),
        );
  const specialCat =
    specialGroup &&
    specialGroup.categories.find(
      (c) => c.tax_kind === SPECIAL_TK && c.is_visible !== false,
    );
  // цвет — как у обычного чипа этой группы («Прочее и налоги» → стальной серый)
  const specialCol = specialGroup ? groupColor(specialGroup.name) : null;
  const dialogRef = useModalA11y(close);
  return (
    <div
      onClick={close}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.3)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 160,
        opacity: shown ? 1 : 0,
        transition: `opacity ${shown ? 280 : 220}ms ease`,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Категория"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.white,
          width: "100%",
          maxWidth: 480,
          borderRadius: "16px 16px 0 0",
          display: "flex",
          flexDirection: "column",
          maxHeight: "88dvh",
          paddingBottom: "env(safe-area-inset-bottom)",
          transform: shown ? "translateY(0)" : "translateY(100%)",
          transition: `transform ${shown ? 280 : 220}ms ${EASE}`,
          outline: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "8px 0 2px",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              background: "#D5D7DD",
            }}
          />
        </div>
        <div
          style={{
            padding: "4px 16px 12px",
            borderBottom: `1px solid ${C.silver}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 15,
              fontFamily: FONT,
              color: C.dark,
              fontWeight: 600,
            }}
          >
            Категория
          </span>
          <button
            type="button"
            onClick={close}
            aria-label="Закрыть"
            style={{
              border: "none",
              background: "none",
              color: C.gray,
              fontSize: 18,
              cursor: "pointer",
            }}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <div style={{ padding: "10px 16px 6px", flexShrink: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              border: `1px solid #EEF0F4`,
              padding: "8px 12px",
              gap: 8,
              background: "#F6F7F9",
              borderRadius: 10,
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke={C.grayL}
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск статьи…"
              aria-label="Поиск статьи"
              style={{
                border: "none",
                outline: "none",
                flex: 1,
                minWidth: 0,
                fontSize: 13,
                background: "none",
                fontFamily: FONT,
                color: C.dark,
              }}
            />
          </div>
        </div>
        <div style={{ padding: "6px 0 12px", overflow: "auto", flex: 1 }}>
          {specialCat && (
            <div style={{ marginBottom: 4 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 16px 4px",
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: specialCol.fg,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: C.gray,
                    fontFamily: FONT,
                  }}
                >
                  Не списывается в расход
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  padding: "2px 16px 6px",
                }}
              >
                <button
                  onClick={() => pick(specialCat.name)}
                  style={{
                    padding: "7px 12px",
                    border: `1px solid ${
                      selected === specialCat.name ? specialCol.fg : C.silver
                    }`,
                    background:
                      selected === specialCat.name ? specialCol.bg : C.white,
                    color:
                      selected === specialCat.name ? specialCol.fg : C.dark,
                    fontFamily: FONT,
                    fontSize: 12,
                    cursor: "pointer",
                    borderRadius: 8,
                    fontWeight: selected === specialCat.name ? 700 : 500,
                  }}
                >
                  {specialCat.name}
                </button>
              </div>
              <div
                style={{
                  height: 1,
                  background: C.silver,
                  margin: "2px 16px 6px",
                }}
              />
            </div>
          )}
          {visGroups.map((g) => {
            const col = groupColor(g.name);
            return (
              <div key={g.id} style={{ marginBottom: 4 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 16px 4px",
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: col.fg,
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: C.gray,
                      fontFamily: FONT,
                    }}
                  >
                    {g.name}
                  </span>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                    padding: "2px 16px 6px",
                  }}
                >
                  {g.cats.map((c) => {
                    const sel = selected === c.name;
                    return (
                      <button
                        key={c.id}
                        onClick={() => pick(c.name)}
                        style={{
                          padding: "7px 12px",
                          border: `1px solid ${sel ? col.fg : C.silver}`,
                          background: sel ? col.bg : C.white,
                          color: sel ? col.fg : C.dark,
                          fontFamily: FONT,
                          fontSize: 12,
                          cursor: "pointer",
                          borderRadius: 8,
                          fontWeight: sel ? 700 : 500,
                        }}
                      >
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {visGroups.length === 0 && (
            <div
              style={{
                padding: "24px 16px",
                textAlign: "center",
                fontSize: 13,
                color: C.grayL,
                fontFamily: FONT,
              }}
            >
              Ничего не найдено
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
