import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installChunkErrorAutoReload } from "./lib/chunkErrorReload";
import { installPerfDebug } from "./lib/perfDebug";

installPerfDebug();
installChunkErrorAutoReload();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
