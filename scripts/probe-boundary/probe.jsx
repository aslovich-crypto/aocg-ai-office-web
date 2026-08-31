// ⚠️ ПРОБА ПЕРЕХВАТА. Рендерит НАСТОЯЩИЙ ErrorBoundary с ребёнком, который
// бросает при отрисовке, — то есть воспроизводит ровно тот случай, что дал
// белый экран 31.08.2026. Проверяется не наличие файла, а поведение.
import { createRoot } from "react-dom/client";
import ErrorBoundary from "../../src/components/ErrorBoundary.jsx";

function Ломака() {
  throw new TypeError("подставная поломка отрисовки");
}
function Целая() {
  return <div>целый экран на месте</div>;
}
createRoot(document.getElementById("root")).render(
  <div>
    <div data-проба="сломанный">
      <ErrorBoundary>
        <Ломака />
      </ErrorBoundary>
    </div>
    <div data-проба="целый">
      <ErrorBoundary>
        <Целая />
      </ErrorBoundary>
    </div>
  </div>,
);
