// ⚠️ ПОДСТАВНОЙ ОТВЕТ СЕТИ. AccountTab до своего запроса не рисует НИЧЕГО
// (`if (!me) return …`), и без подставы сторож не увидел бы ни «Ваша роль»,
// ни «Мои карты», ни согласие — то есть молча проверял бы пустой экран.
// Это ровно тот молчащий пропуск, за который ловим весь проект (T87).
window.fetch = () =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        id: 1,
        first_name: "Иван",
        last_name: "Петров",
        email: "i@example.com",
        phone: "",
        role: "admin",
        is_email_verified: true,
        consent_version: 1,
        consent_at: "2026-08-01T00:00:00Z",
        linked_providers: [],
      }),
    text: () => Promise.resolve("{}"),
  });

// ⚠️ ПРОБНАЯ СТРАНИЦА ДЛЯ СТОРОЖА КАНОНА. Рендерит НАСТОЯЩИЕ компоненты
// кабинета и вешает на каждый экран признак с его именем. Сторож потом
// читает получившийся DOM — то есть смотрит на отрисованный экран,
// а не на список в исходнике. Ровно этого не умела прежняя сверка:
// она пропустила четыре расхождения подряд.
import { createRoot } from "react-dom/client";
import {
  ProfileHub,
  AccountTab,
  SecurityTab,
  CategoriesTab,
  ServicesTab,
} from "../../src/App.jsx";

const ЭКРАНЫ = [
  [
    "Аккаунт",
    <AccountTab
      cards={[]}
      onAddCard={() => {}}
      onUpdateCard={() => {}}
      onDeleteCard={() => {}}
      onSetDefaultCard={() => {}}
    />,
  ],
  ["Безопасность", <SecurityTab me={{ linked_providers: [] }} />],
  [
    "Категории",
    <CategoriesTab role="admin" catalog={null} onCatalogRefresh={() => {}} />,
  ],
  ["Интеграции", <ServicesTab servicesList={[]} />],
];

createRoot(document.getElementById("root")).render(
  <div>
    <div data-proba="хаб">
      <ProfileHub
        role="admin"
        me={{ first_name: "Иван", last_name: "Петров" }}
        onOpen={() => {}}
        onLogout={() => {}}
      />
    </div>
    {ЭКРАНЫ.map(([имя, узел]) => (
      <div key={имя} data-proba="экран" data-imya={имя}>
        {узел}
      </div>
    ))}
  </div>,
);
