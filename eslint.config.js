import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  // design/handoff — распакованная выгрузка Claude Design (см. .gitignore).
  // Это ЧУЖОЙ код: .jsx из проекта ДС не наш и нашим правилам не подчиняется.
  // ⚠️ Без игнора eslint даёт 133 ошибки из 11 файлов выгрузки, и `npm run lint`
  // краснеет на том, чего мы не писали. Правило ПОСТОЯННОЕ — каталог без даты
  // в имени, поэтому следующая выгрузка попадёт под него сама.
  globalIgnores(["dist", "design/handoff"]),
  {
    files: ["**/*.{js,jsx}"],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
]);
