import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { ScreenActionProvider } from "./components/ActionBar";
import { initOverflowDebug } from "./lib/overflowDebug";

// Диагностика «кто шире экрана». Молчит, пока в адресе нет #overflow.
initOverflowDebug();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {/* Действие экрана объявляется хуком useScreenAction, а рисуется полосой
        в оболочке. Провайдер стоит ЗДЕСЬ, а не внутри App: потребитель обязан
        находиться ниже провайдера, а слот полосы живёт как раз внутри App. */}
    <ScreenActionProvider>
      <App />
    </ScreenActionProvider>
  </StrictMode>,
);
