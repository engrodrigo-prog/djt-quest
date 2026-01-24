import { execFileSync } from "node:child_process";

const vercelEnv = process.env.VERCEL_ENV;
const isProd = vercelEnv === "production";
const isPreview = vercelEnv === "preview";
const force = process.env.SUPABASE_FORCE_MIGRATE === "1";
const allowPreview = process.env.SUPABASE_MIGRATE_ON_PREVIEW === "1";

const shouldRun = isProd || force || (isPreview && allowPreview);
if (!shouldRun) {
  console.log(`[migrate] Skip (VERCEL_ENV=${vercelEnv ?? "local"})`);
  process.exit(0);
}

const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
const dbPassword = process.env.SUPABASE_DB_PASSWORD;

if (!dbUrl && (!accessToken || !dbPassword)) {
  const msg =
    "Missing SUPABASE_DB_URL (recommended) or SUPABASE_ACCESS_TOKEN + SUPABASE_DB_PASSWORD for migrations.";
  if (force) {
    throw new Error(msg);
  }
  console.log(`[migrate] ${msg} Skipping.`);
  process.exit(0);
}

const run = (command, args) => {
  execFileSync(command, args, { stdio: "inherit" });
};

const args = ["db", "push", "--yes"];
if (dbUrl) {
  args.push("--db-url", dbUrl);
} else if (dbPassword) {
  args.push("--password", dbPassword);
}

console.log("[migrate] Running supabase db push");

try {
  run("supabase", args);
} catch (err) {
  if (err && err.code === "ENOENT") {
    run("npx", ["--yes", "supabase@latest", ...args]);
  } else {
    throw err;
  }
}
