import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function vendorChunkName(id: string) {
  if (!id.includes("node_modules")) return undefined;

  const normalized = id.replaceAll("\\", "/");

  if (
    normalized.includes("/node_modules/react/") ||
    normalized.includes("/node_modules/react-dom/") ||
    normalized.includes("/node_modules/react-router/") ||
    normalized.includes("/node_modules/react-router-dom/") ||
    normalized.includes("/node_modules/scheduler/")
  ) {
    return "vendor-react";
  }

  if (
    normalized.includes("/node_modules/@supabase/") ||
    normalized.includes("/node_modules/@tanstack/")
  ) {
    return "vendor-data";
  }

  if (
    normalized.includes("/node_modules/@radix-ui/") ||
    normalized.includes("/node_modules/cmdk/") ||
    normalized.includes("/node_modules/vaul/") ||
    normalized.includes("/node_modules/sonner/") ||
    normalized.includes("/node_modules/input-otp/") ||
    normalized.includes("/node_modules/embla-carousel-react/") ||
    normalized.includes("/node_modules/class-variance-authority/") ||
    normalized.includes("/node_modules/clsx/") ||
    normalized.includes("/node_modules/tailwind-merge/")
  ) {
    return "vendor-ui";
  }

  if (
    normalized.includes("/node_modules/leaflet/") ||
    normalized.includes("/node_modules/react-leaflet/") ||
    normalized.includes("/node_modules/exifr/")
  ) {
    return "vendor-maps";
  }

  if (normalized.includes("/node_modules/recharts/")) {
    return "vendor-charts";
  }

  if (
    normalized.includes("/node_modules/date-fns/") ||
    normalized.includes("/node_modules/react-day-picker/")
  ) {
    return "vendor-dates";
  }

  if (
    normalized.includes("/node_modules/react-hook-form/") ||
    normalized.includes("/node_modules/@hookform/resolvers/") ||
    normalized.includes("/node_modules/zod/")
  ) {
    return "vendor-forms";
  }

  if (
    normalized.includes("/node_modules/dompurify/") ||
    normalized.includes("/node_modules/lucide-react/") ||
    normalized.includes("/node_modules/next-themes/")
  ) {
    return "vendor-misc";
  }

  return undefined;
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const sourcemapEnabled =
    env.VITE_SOURCEMAP === "true" || env.GENERATE_SOURCEMAP === "true";

  return {
    // Vite expõe variáveis de ambiente no frontend apenas por prefixo.
    // Mantemos compat com padrões "NEXT_PUBLIC_*" (também usado em Vercel/Next) para flags.
    envPrefix: ["VITE_", "NEXT_PUBLIC_"],
    build: {
      sourcemap: sourcemapEnabled,
      rollupOptions: {
        output: {
          manualChunks(id) {
            return vendorChunkName(id);
          },
        },
      },
    },
    server: {
      host: "::",
      port: 8080,
      proxy: {
        "/api": {
          target: "http://localhost:3000",
          changeOrigin: true,
        },
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
