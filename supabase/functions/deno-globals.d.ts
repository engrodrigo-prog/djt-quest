// Minimal Deno globals for editor/TS tooling when not using the Deno VSCode extension.
// These are runtime-provided by Supabase Edge Functions (Deno).

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
  serve: (
    handler: (req: Request) => Response | Promise<Response>,
    options?: any,
  ) => void;
};

