import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // Vite expõe variáveis de ambiente no frontend apenas por prefixo.
  // Mantemos compat com padrões "NEXT_PUBLIC_*" (também usado em Vercel/Next) para flags.
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
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
}));
