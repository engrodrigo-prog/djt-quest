import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const baselinePath = resolve(process.cwd(), "scripts/lint-baseline.json");

const parseArgs = () => {
  const args = new Set(process.argv.slice(2));
  return {
    writeBaseline: args.has("--write-baseline"),
  };
};

const runEslintJson = () => {
  const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
  const res = spawnSync(
    cmd,
    ["eslint", ".", "--format", "json"],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );

  const stdout = String(res.stdout || "").trim();
  const stderr = String(res.stderr || "").trim();
  if (!stdout) {
    const hint = stderr ? `\n\neslint stderr:\n${stderr.slice(0, 2000)}` : "";
    throw new Error(`eslint did not produce JSON output.${hint}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (e) {
    // Some environments may prepend non-JSON noise; try to extract the JSON array.
    const start = stdout.indexOf("[");
    const end = stdout.lastIndexOf("]");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        parsed = JSON.parse(stdout.slice(start, end + 1));
      } catch {
        const hint = stderr ? `\n\neslint stderr:\n${stderr.slice(0, 2000)}` : "";
        throw new Error(`Failed to parse eslint JSON output.${hint}`);
      }
    } else {
      const hint = stderr ? `\n\neslint stderr:\n${stderr.slice(0, 2000)}` : "";
      throw new Error(`Failed to parse eslint JSON output.${hint}`);
    }
  }

  return { results: parsed, exitCode: res.status ?? 0, stderr };
};

const summarize = (results) => {
  const out = {
    errors: 0,
    warnings: 0,
    files: 0,
    rules: {},
    updated_at: new Date().toISOString(),
  };

  const list = Array.isArray(results) ? results : [];
  out.files = list.length;
  for (const file of list) {
    const messages = Array.isArray(file?.messages) ? file.messages : [];
    for (const m of messages) {
      const sev = Number(m?.severity ?? 0);
      if (sev === 2) out.errors += 1;
      else if (sev === 1) out.warnings += 1;
      const ruleId = String(m?.ruleId || "").trim() || "unknown";
      out.rules[ruleId] = (out.rules[ruleId] || 0) + 1;
    }
  }
  return out;
};

const readBaseline = () => {
  try {
    const raw = readFileSync(baselinePath, "utf8");
    const json = JSON.parse(raw);
    return json && typeof json === "object" ? json : null;
  } catch {
    return null;
  }
};

const main = async () => {
  const { writeBaseline } = parseArgs();
  const { results } = runEslintJson();
  const summary = summarize(results);

  const baseline = readBaseline();
  if (!baseline || writeBaseline) {
    writeFileSync(baselinePath, JSON.stringify(summary, null, 2) + "\n", "utf8");
    console.log(`lint:gate baseline written: scripts/lint-baseline.json`);
    console.log(`errors=${summary.errors} warnings=${summary.warnings} files=${summary.files}`);
    process.exit(0);
  }

  const baseErrors = Number(baseline?.errors ?? NaN);
  const baseWarnings = Number(baseline?.warnings ?? NaN);
  if (!Number.isFinite(baseErrors) || !Number.isFinite(baseWarnings)) {
    throw new Error("Invalid lint baseline file; re-run with --write-baseline");
  }

  const ok = summary.errors <= baseErrors && summary.warnings <= baseWarnings;
  const status = ok ? "OK" : "REGRESSION";
  console.log(`lint:gate ${status}`);
  console.log(`baseline: errors=${baseErrors} warnings=${baseWarnings}`);
  console.log(`current : errors=${summary.errors} warnings=${summary.warnings}`);

  if (!ok) process.exit(1);
};

main().catch((e) => {
  console.error(`lint:gate failed: ${e?.message || e}`);
  process.exit(2);
});
