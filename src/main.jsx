import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";

// ДИАГНОСТИКА «КТО ШИРЕ ЭКРАНА» ПОДКЛЮЧАЕТСЯ ТОЛЬКО ПО ФЛАГУ СБОРКИ (T19).
//
// Было: безусловный импорт. Модуль (807 строк) попадал в БОЕВОЙ бандл
// и молчал лишь потому, что сам проверял метку в адресе — то есть защитой
// служило его собственное поведение, а не отсутствие кода. Замер 08.08.2026:
// в dist/assets/index-*.js лежали `__overflowScan`, `overflow-hit`,
// `overflow-test` — панель вооружалась на проде одним адресом.
//
// Стало: `import.meta.env.VITE_DIAG` — статическая замена на этапе сборки,
// поэтому при выключенном флаге ветка вырезается вместе с модулем, и его
// в бандле НЕТ ВООБЩЕ. Проверяется сторожем `scripts/check-no-diagnostics.mjs`.
//
// Как включить (нужно для прогона вёрстки tools/layout-audit):
//     VITE_DIAG=1 npm run build && npm run preview
// Прод собирается БЕЗ флага всегда. Ставить его в Railway — исключение,
// осознанное и с обязательным выключением обратно (см. tools/layout-audit/README.md).
if (import.meta.env.VITE_DIAG === "1") {
  import("./lib/overflowDebug").then(({ initOverflowDebug }) =>
    initOverflowDebug(),
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
