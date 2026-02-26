import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installChunkErrorAutoReload } from "./lib/chunkErrorReload";
import { installPerfDebug } from "./lib/perfDebug";
import { AppErrorBoundary } from "./components/AppErrorBoundary";

installPerfDebug();
installChunkErrorAutoReload();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>
);
