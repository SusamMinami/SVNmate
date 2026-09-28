import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applyReducedMotionPreference } from "./app/useReducedMotionPreference";
import "./styles.css";

applyReducedMotionPreference();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
