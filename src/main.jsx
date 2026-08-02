import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { initOverflowDebug } from "./lib/overflowDebug";

// Диагностика «кто шире экрана». Молчит, пока в адресе нет #overflow.
initOverflowDebug();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
