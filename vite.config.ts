import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Chunk strategy — read before editing.
//
// WHY a single vendor chunk?
//
// The previous strategy used multiple named vendor chunks (vendor-react,
// vendor-data, vendor-ui, vendor-charts, etc.).  It caused a production crash:
//
//   TypeError: Cannot read properties of undefined (reading 'createContext')
//
// Root cause (Rollup 4 / Vite 7 bug interaction):
//
//   1. Many node_modules packages (recharts, react-leaflet, @tanstack/*,
//      @radix-ui/*, exifr…) are TypeScript-compiled CJS bundles.  Each one
//      contains an identical inline helper that implements CJS→ESM interop
//      (a function equivalent to Babel's __interopRequireDefault / TS's
//      __importDefault).
//
//   2. Rollup deduplicates these identical helpers across manual chunks.
//      It picks *one* chunk as the canonical location and makes every other
//      chunk that uses the helper import it from there.
//
//   3. The React chunk (vendor-react) also needs that interop helper once —
//      to wrap React's own CJS exports into an ESM default (the `sh(_)` line).
//      Because the helper was already placed in another chunk, Rollup emits:
//
//        vendor-react → import sh from vendor-X
//        vendor-X     → import React from vendor-react   ← circular!
//
//   4. Several packages in vendor-X call React.createContext() at *module
//      evaluation time* (top-level `const ctx = React.createContext(...)`).
//      Because of the circular import, React is still `undefined` when those
//      lines run → crash.
//
//   No combination of two or more vendor chunks avoids this:  as long as the
//   React chunk and any other chunk both contain CJS packages, Rollup will
//   always move the shared helper to the "lower" chunk and create the cycle.
//
// Solution: put every node_modules package into ONE chunk (vendor-libs).
//   • The interop helper lives inside vendor-libs — no cross-chunk import needed.
//   • vendor-libs is self-contained; the application lazy chunks just import
//     from it without creating any cycle.
//   • Gzip sizes are comparable to the old split scheme (the same bytes ship,
//     just in one file instead of seven).
//
// Trade-off: finer cache granularity is lost — any dep update busts the whole
//   vendor hash.  This is acceptable given a lockfile-driven CI pipeline.
//   Re-introduce per-category manual chunks only after verifying (with `vite
//   preview` in a browser) that the production build is cycle-free.
// ---------------------------------------------------------------------------

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const sourcemapEnabled =
    env.VITE_SOURCEMAP === "true" || env.GENERATE_SOURCEMAP === "true";

  return {
    envPrefix: ["VITE_", "NEXT_PUBLIC_"],
    build: {
      sourcemap: sourcemapEnabled,
      chunkSizeWarningLimit: 1600,
      rollupOptions: {
        output: {
          // All node_modules → one stable vendor chunk.
          // See the comment block above for the full rationale.
          manualChunks(id) {
            if (id.includes("node_modules")) {
              return "vendor-libs";
            }
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
      dedupe: ["react", "react-dom"],
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
