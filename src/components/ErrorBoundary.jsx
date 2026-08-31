import { Component } from "react";

// ⚠️ ПЕРЕХВАТ ОШИБОК ВЕРХНЕГО УРОВНЯ. Заведён 31.08.2026 по блокеру:
// владелец нажал «Отправить приглашение» и получил БЕЛЫЙ ЭКРАН — приложение
// исчезло целиком, осталась одна адресная строка. Так было устроено с самого
// начала: перехвата не существовало НИ ОДНОГО (замер того же дня — ни
// ErrorBoundary, ни window.onerror, ни unhandledrejection), а React при
// необработанном исключении в отрисовке размонтирует ВСЁ дерево. То есть
// поломка одной кнопки убивала всё приложение — и это не свойство той кнопки,
// а свойство сборки: ровно так же выглядела бы любая будущая ошибка.
//
// ⚠️ ЭТОТ ЭКРАН — ПРИБОР, А НЕ ИЗВИНЕНИЕ. Белый экран не сообщает ничего:
// ни что сломалось, ни где. Здесь человек видит причину и может её передать
// одной кнопкой. Без этого причину знает только консоль браузера, а владелец
// работает с телефона, где консоли нет.
//
// ⚠️ ОН ОБЯЗАН РАБОТАТЬ, КОГДА СЛОМАНО ОСТАЛЬНОЕ. Поэтому здесь нет ни
// импорта темы, ни общих кнопок, ни шрифтовых констант — только собственные
// значения. Перехватчик, падающий вместе с приложением, бесполезен.

const ФОН = "#F6F7F9";
const КАРТА = "#FFFFFF";
const РАМКА = "#E5E8EF";
const ТЕКСТ = "#111318";
const ТУСКЛЫЙ = "#636B7D";
const ШРИФТ =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

function собратьПричину(ошибка, сведения) {
  const части = [];
  части.push(String((ошибка && (ошибка.stack || ошибка.message)) || ошибка));
  const стек = сведения && сведения.componentStack;
  if (стек) части.push("Компоненты:" + стек);
  части.push(
    "Адрес: " + (typeof location !== "undefined" ? location.href : "—"),
  );
  части.push(
    "Браузер: " +
      (typeof navigator !== "undefined" ? navigator.userAgent : "—"),
  );
  return части.join("\n\n");
}

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { причина: null, скопировано: false };
  }

  static getDerivedStateFromError(ошибка) {
    return {
      причина: String((ошибка && (ошибка.stack || ошибка.message)) || ошибка),
    };
  }

  componentDidCatch(ошибка, сведения) {
    // ⚠️ ПОЛНАЯ ПРИЧИНА СОБИРАЕТСЯ ЗДЕСЬ: getDerivedStateFromError не получает
    // стек компонентов, а именно он называет ВИНОВНЫЙ КОМПОНЕНТ. Без него у нас
    // есть «TypeError: … is not a function» и ни слова о том, где.
    this.setState({ причина: собратьПричину(ошибка, сведения) });
    try {
      console.error("[БЕЛЫЙ ЭКРАН ПРЕДОТВРАЩЁН]", ошибка, сведения);
    } catch {
      /* консоли может не быть */
    }
  }

  скопировать = () => {
    const текст = this.state.причина || "";
    const готово = () => this.setState({ скопировано: true });
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(текст).then(готово, () => {});
        return;
      }
    } catch {
      /* буфер недоступен — ниже показан сам текст, его можно выделить */
    }
  };

  render() {
    if (!this.state.причина) return this.props.children;
    return (
      <div
        style={{
          minHeight: "100vh",
          background: ФОН,
          color: ТЕКСТ,
          fontFamily: ШРИФТ,
          padding: "24px 16px 40px",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            background: КАРТА,
            border: `1px solid ${РАМКА}`,
            borderRadius: 12,
            padding: "16px 16px 18px",
            maxWidth: 560,
            margin: "0 auto",
          }}
        >
          <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 6 }}>
            Экран не открылся
          </div>
          <div
            style={{
              fontSize: 13,
              color: ТУСКЛЫЙ,
              lineHeight: 1.5,
              marginBottom: 14,
            }}
          >
            Приложение споткнулось на этом экране. Остальное работает —
            вернитесь назад или перезагрузите. Причина ниже: передайте её
            целиком, по ней видно, что именно сломалось.
          </div>

          <pre
            style={{
              background: ФОН,
              border: `1px solid ${РАМКА}`,
              borderRadius: 8,
              padding: "10px 12px",
              fontSize: 11,
              lineHeight: 1.45,
              color: ТЕКСТ,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 320,
              overflow: "auto",
              margin: "0 0 14px",
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            }}
          >
            {this.state.причина}
          </pre>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={this.скопировать}
              style={{
                flex: "1 1 140px",
                padding: "11px 14px",
                borderRadius: 10,
                border: "none",
                background: ТЕКСТ,
                color: "#FFFFFF",
                fontSize: 14,
                fontWeight: 600,
                fontFamily: ШРИФТ,
                cursor: "pointer",
              }}
            >
              {this.state.скопировано ? "Скопировано ✓" : "Скопировать причину"}
            </button>
            <button
              type="button"
              onClick={() => {
                try {
                  location.reload();
                } catch {
                  /* ignore */
                }
              }}
              style={{
                flex: "1 1 140px",
                padding: "11px 14px",
                borderRadius: 10,
                border: `1px solid ${РАМКА}`,
                background: КАРТА,
                color: ТЕКСТ,
                fontSize: 14,
                fontWeight: 600,
                fontFamily: ШРИФТ,
                cursor: "pointer",
              }}
            >
              Перезагрузить
            </button>
          </div>
        </div>
      </div>
    );
  }
}
