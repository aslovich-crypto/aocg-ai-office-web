import { useEffect, useState } from "react";
import LoadFailure from "./LoadFailure";
import { FONT, theme } from "../lib/theme";

// Блок «Ключи доступа» на экране «Интеграции» (шаг 3, заход ⑧).
//
// ⚠️ ПОЧЕМУ ЗДЕСЬ, А НЕ ОТДЕЛЬНЫМ ПУНКТОМ НАСТРОЕК. Решение владельца
// 13.09.2026: канон настроек не трогаем, нового пункта не заводим. Экран уже
// называется «Интеграции», человек ищет ключ интеграции там. Смысл разводят
// ЗАГОЛОВКИ: выше — услуги, которые мы потребляем, здесь — ключи доступа,
// которые мы выдаём наружу.
//
// ⚠️ ПРАВА РЕЖУТСЯ РОЛЬЮ ВНУТРИ ЭКРАНА, как у «Пользователей»: список видят
// администратор и бухгалтер, выпуск и отзыв — только администратор. Фронтовый
// гейт защитой НЕ считается: настоящий стоит в бэкенде, здесь он только
// про то, что не надо показывать кнопку, которая всё равно получит отказ.
//
// ⚠️ СЕКРЕТ ПОКАЗЫВАЕТСЯ ОДИН РАЗ, И ТЕКСТ ОБ ЭТОМ СТОИТ ДО НАЖАТИЯ, А НЕ
// ПОСЛЕ (требование владельца). После — это уже не предупреждение, а
// соболезнование: восстановить секрет нельзя ни нам, ни владельцу, в базе
// лежит только его хеш.

const СРОК_ПО_УМОЛЧАНИЮ = 365;

function датой(значение) {
  if (!значение) return "—";
  const д = new Date(значение);
  return Number.isNaN(д.getTime()) ? "—" : д.toLocaleDateString("ru-RU");
}

// ⚠️ «Осталось дней» приходит С СЕРВЕРА и здесь не пересчитывается. Часы
// браузера могут врать, а по этому числу человек решает, пора ли поворачивать
// ключ. Один источник на всех смотрящих.
function срокомСловами(ключ) {
  if (ключ.revoked_at) return `отозван ${датой(ключ.revoked_at)}`;
  if (!ключ.is_active) return `истёк ${датой(ключ.expires_at)}`;
  return `до ${датой(ключ.expires_at)} · осталось ${ключ.days_left} дн.`;
}

const стиль = {
  карточка: {
    background: theme.surface,
    border: `1px solid ${theme.border}`,
    borderRadius: theme.rCard,
    padding: "12px 14px",
    marginBottom: 8,
    fontFamily: FONT,
  },
  подпись: {
    fontSize: 12,
    color: theme.fg2,
    fontFamily: FONT,
    lineHeight: 1.5,
  },
  моно: {
    background: theme.surfaceSunk,
    border: `1px solid ${theme.border}`,
    borderRadius: 10,
    padding: "10px 12px",
    fontSize: 12,
    color: theme.fg1,
    fontFamily: theme.fontMono,
    wordBreak: "break-all",
    marginBottom: 10,
  },
  поле: {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    borderRadius: 10,
    border: `1px solid ${theme.border}`,
    // ⚠️ 16px, А НЕ МЕНЬШЕ (T138): Safari зумит страницу на поле с мелким
    // кеглем и обратно её не возвращает — человек остаётся на увеличенном
    // экране и не понимает, что произошло.
    fontSize: 16,
    fontFamily: FONT,
    marginBottom: 8,
  },
};

export default function IntegrationKeys({ authFetch, role, Btn, SectionHead }) {
  const админ = role === "admin";
  const видитСписок = админ || role === "accountant";

  const [ключи, setКлючи] = useState([]);
  const [сбой, setСбой] = useState(false);
  const [попытка, setПопытка] = useState(0);
  const [форма, setФорма] = useState(null);
  const [имя, setИмя] = useState("");
  const [дней, setДней] = useState(String(СРОК_ПО_УМОЛЧАНИЮ));
  const [выпущенный, setВыпущенный] = useState(null);
  const [ошибка, setОшибка] = useState("");
  // Не ошибка, а известие: «ключ уже отозван» — исход, а не отказ.
  const [заметка, setЗаметка] = useState("");
  const [занят, setЗанят] = useState(false);
  const [отзываем, setОтзываем] = useState(null);

  useEffect(() => {
    if (!видитСписок) return;
    authFetch("/api/integration-keys/")
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => {
        setКлючи(Array.isArray(d) ? d : []);
        setСбой(false);
      })
      // ⚠️ Пустой список и «не загрузилось» выглядели бы одинаково (T171):
      // человек прочитал бы «ключей нет» и выпустил третий поверх двух живых.
      .catch(() => setСбой(true));
  }, [authFetch, попытка, видитСписок]);

  if (!видитСписок) return null;

  async function выпустить() {
    setОшибка("");
    setЗанят(true);
    try {
      const r = await authFetch("/api/integration-keys/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: имя.trim(),
          expires_days: Number(дней) || СРОК_ПО_УМОЛЧАНИЮ,
        }),
      });
      const тело = await r.json().catch(() => null);
      if (!r.ok) {
        setОшибка(
          (тело && typeof тело.detail === "string" && тело.detail) ||
            `Сервер ответил ${r.status}`,
        );
        return;
      }
      setВыпущенный(тело);
      setФорма(null);
      setИмя("");
      setДней(String(СРОК_ПО_УМОЛЧАНИЮ));
      setПопытка((н) => н + 1);
    } catch {
      setОшибка("Нет связи с сервером");
    } finally {
      setЗанят(false);
    }
  }

  async function отозвать(id) {
    setОшибка("");
    setЗаметка("");
    try {
      const r = await authFetch(`/api/integration-keys/${id}/revoke`, {
        method: "POST",
      });
      // ⚠️ 404 НА ОТЗЫВЕ — НЕ ОШИБКА, А ИСХОД (решение владельца 13.09.2026).
      // Бэкенд отвечает так и на уже отозванный ключ: второе нажатие не
      // переписывает время первого. Человек сделал то, что хотел, — ключ
      // не работает; ему нужен свежий список, а не красная плашка.
      if (r.status === 404) {
        setОтзываем(null);
        setЗаметка("Ключ уже отозван — список обновлён");
        setПопытка((н) => н + 1);
        return;
      }
      if (!r.ok) {
        setОшибка(`Отозвать не удалось — сервер ответил ${r.status}`);
        return;
      }
      setОтзываем(null);
      setПопытка((н) => н + 1);
    } catch {
      setОшибка("Нет связи с сервером");
    }
  }

  return (
    <div style={{ marginTop: 24 }}>
      <SectionHead title="Ключи доступа" />

      <div style={{ ...стиль.подпись, marginBottom: 12 }}>
        Ключ открывает доступ к одобренным отчётам из 1С и других программ.
        Секрет ключа показывается один раз при выпуске и не восстанавливается —
        потеряли, отзовите ключ и выпустите новый. Живых ключей может быть не
        больше двух: второй нужен, чтобы сменить ключ, не останавливая обмен.
      </div>

      {сбой && (
        <div style={{ marginBottom: 12 }}>
          <LoadFailure
            что="список ключей"
            onRetry={() => setПопытка((н) => н + 1)}
          />
        </div>
      )}

      {выпущенный && (
        <div
          style={{
            ...стиль.карточка,
            background: theme.warningBg,
            border: `1px solid ${theme.warningBd}`,
          }}
        >
          <div
            style={{
              fontSize: 13,
              color: theme.warningFg,
              fontFamily: FONT,
              marginBottom: 8,
              lineHeight: 1.5,
            }}
          >
            Скопируйте ключ сейчас — больше он не покажется.
          </div>
          <div style={стиль.моно}>{выпущенный.key}</div>
          <Btn outline small onClick={() => setВыпущенный(null)}>
            Я скопировал
          </Btn>
        </div>
      )}

      {ключи.map((к) => (
        <div key={к.id} style={стиль.карточка}>
          <div
            style={{
              fontSize: 14,
              color: к.is_active ? theme.fg1 : theme.fg3,
              marginBottom: 2,
            }}
          >
            {к.name}
          </div>
          <div style={{ ...стиль.подпись, fontFamily: theme.fontMono }}>
            {к.prefix}…
          </div>
          <div style={стиль.подпись}>{срокомСловами(к)}</div>
          <div style={стиль.подпись}>
            {к.last_used_at
              ? `последний раз ${датой(к.last_used_at)} · обращений ${
                  к.use_count
                }`
              : "ещё не использовался"}
          </div>
          {админ && к.is_active && отзываем !== к.id && (
            <div style={{ marginTop: 8 }}>
              <Btn outline small onClick={() => setОтзываем(к.id)}>
                Отозвать
              </Btn>
            </div>
          )}
          {админ && отзываем === к.id && (
            <div style={{ marginTop: 8 }}>
              {/* ⚠️ ПОДТВЕРЖДЕНИЕ СВОЁ, РАЗМЕТКОЙ: системные окна браузера
                  в приложении запрещены (сторож check-native-dialogs).
                  Он читает ИСХОДНИК и ловит имя вызова где угодно, включая
                  комментарий, — поэтому здесь оно даже не написано. */}
              <div style={{ ...стиль.подпись, marginBottom: 6 }}>
                Отозвать ключ? Обмен по нему прекратится сразу.
              </div>
              <Btn small onClick={() => отозвать(к.id)}>
                Да, отозвать
              </Btn>{" "}
              <Btn outline small onClick={() => setОтзываем(null)}>
                Отмена
              </Btn>
            </div>
          )}
        </div>
      ))}

      {!сбой && ключи.length === 0 && (
        <div style={{ ...стиль.подпись, padding: "6px 0 10px" }}>
          Ключей пока нет.
        </div>
      )}

      {заметка && (
        <div role="status" style={{ ...стиль.подпись, marginBottom: 10 }}>
          {заметка}
        </div>
      )}

      {ошибка && (
        <div
          role="alert"
          style={{
            background: theme.errorBg,
            color: theme.errorFg,
            border: `1px solid ${theme.errorBd}`,
            borderRadius: 8,
            padding: "10px 12px",
            fontFamily: FONT,
            fontSize: 13,
            marginBottom: 10,
          }}
        >
          {ошибка}
        </div>
      )}

      {админ && !форма && (
        <Btn full onClick={() => setФорма(true)}>
          + Выпустить ключ
        </Btn>
      )}

      {админ && форма && (
        <div style={стиль.карточка}>
          <input
            style={стиль.поле}
            placeholder="Название, например «1С бюро»"
            value={имя}
            onChange={(e) => setИмя(e.target.value)}
          />
          <input
            style={стиль.поле}
            type="number"
            min="1"
            max="365"
            placeholder="Срок в днях"
            value={дней}
            onChange={(e) => setДней(e.target.value)}
          />
          <div style={{ ...стиль.подпись, marginBottom: 8 }}>
            Срок обязателен, не больше года. Бессрочный ключ выпустить нельзя.
          </div>
          <Btn
            onClick={выпустить}
            disabled={!имя.trim() || занят}
            loading={занят}
          >
            Выпустить
          </Btn>{" "}
          <Btn outline onClick={() => setФорма(null)}>
            Отмена
          </Btn>
        </div>
      )}
    </div>
  );
}
