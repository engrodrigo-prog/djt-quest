import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installChunkErrorAutoReload } from "./lib/chunkErrorReload";
import { installPerfDebug } from "./lib/perfDebug";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { DJT_CANONICAL_ORIGIN, isBannedProjectHost } from "./lib/whatsappShare";

installPerfDebug();
installChunkErrorAutoReload();

if (typeof window !== "undefined" && isBannedProjectHost(window.location.hostname)) {
  const nextUrl = `${DJT_CANONICAL_ORIGIN}${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.replace(nextUrl);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>
);
