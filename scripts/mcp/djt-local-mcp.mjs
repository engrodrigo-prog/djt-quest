#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createClient } from "@supabase/supabase-js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);

const jsonText = (value) => {
  if (value == null) return "null";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const okText = (value) => ({ content: [{ type: "text", text: jsonText(value) }] });

const safeError = (e) => {
  const msg = String(e?.message || e || "Unknown error");
  return { content: [{ type: "text", text: msg }] };
};

const isAbortError = (e) => Boolean(e && (e.name === "AbortError" || /aborted/i.test(String(e?.message || ""))));

const withTimeout = async (promise, ms, label = "timeout") => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(label), ms);
  try {
    const res = await promise(ctl.signal);
    return res;
  } finally {
    clearTimeout(t);
  }
};

const fetchJson = async (url, opts = {}) => {
  const method = String(opts.method || "GET").toUpperCase();
  const headers = opts.headers && typeof opts.headers === "object" ? opts.headers : {};
  const body = opts.body == null ? undefined : JSON.stringify(opts.body);
  const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : 25_000;

  return await withTimeout(
    async (signal) => {
      const resp = await fetch(url, { method, headers, body, signal });
      const text = await resp.text().catch(() => "");
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (!resp.ok) {
        const errMsg = (data && typeof data === "object" && data.error) ? String(data.error) : text || resp.statusText;
        throw new Error(`${method} ${url} failed (${resp.status}): ${errMsg}`);
      }
      return data;
    },
    timeoutMs,
    `fetch ${method} ${url}`,
  );
};

const exists = async (p) => {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
};

const findRepoRoot = async (startDir) => {
  let current = path.resolve(startDir || process.cwd());
  for (let i = 0; i < 30; i += 1) {
    if (await exists(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(startDir || process.cwd());
};

const exec = async (cmd, args, cwd) => {
  const resp = await execFileAsync(cmd, args, { cwd, maxBuffer: 1024 * 1024 });
  return String(resp.stdout || "").trim();
};

const parseGitHubRepo = (remoteUrl) => {
  const raw = String(remoteUrl || "").trim();
  if (!raw) return null;
  // https://github.com/owner/repo(.git)
  let m = raw.match(/^https?:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?\/?$/i);
  if (m) return { owner: m[1], repo: m[2] };
  // git@github.com:owner/repo(.git)
  m = raw.match(/^git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/i);
  if (m) return { owner: m[1], repo: m[2] };
  return null;
};

const detectGitHubRepo = async (repoRoot) => {
  const envRepo = String(process.env.GITHUB_REPO || "").trim();
  if (envRepo && envRepo.includes("/")) {
    const [owner, repo] = envRepo.split("/", 2);
    if (owner && repo) return { owner, repo };
  }
  try {
    const url = await exec("git", ["remote", "get-url", "origin"], repoRoot);
    return parseGitHubRepo(url);
  } catch {
    return null;
  }
};

const detectVercelProject = async (repoRoot) => {
  const p = path.join(repoRoot, ".vercel", "project.json");
  try {
    const raw = await fs.readFile(p, "utf-8");
    const json = JSON.parse(raw);
    const projectId = String(json?.projectId || "").trim() || null;
    const orgId = String(json?.orgId || "").trim() || null;
    const projectName = String(json?.projectName || "").trim() || null;
    return { projectId, orgId, projectName, source: "vercel-project.json" };
  } catch {
    return { projectId: null, orgId: null, projectName: null, source: "none" };
  }
};

const firstNonEmpty = (...values) => {
  for (const v of values) {
    const s = String(v || "").trim();
    if (s) return s;
  }
  return null;
};

const normalizeUrl = (raw) => {
  const s = String(raw || "").trim();
  if (!s) return null;
  return s.replace(/\/+$/, "");
};

const parseDotenv = (raw) => {
  const out = {};
  const lines = String(raw || "").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const withoutExport = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const eq = withoutExport.indexOf("=");
    if (eq <= 0) continue;
    const key = withoutExport.slice(0, eq).trim();
    if (!key) continue;
    let val = withoutExport.slice(eq + 1).trim();
    if ((val.startsWith("\"") && val.endsWith("\"")) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
};

const readDotenvSupabase = async (repoRoot) => {
  const files = [".env.local", ".env.development.local", ".env.development", ".env"];
  const out = {
    VITE_SUPABASE_URL: null,
    VITE_SUPABASE_ANON_KEY: null,
    VITE_SUPABASE_PUBLISHABLE_KEY: null,
  };

  for (const rel of files) {
    const p = path.join(repoRoot, rel);
    if (!await exists(p)) continue;
    try {
      const raw = await fs.readFile(p, "utf-8");
      const parsed = parseDotenv(raw);
      for (const k of Object.keys(out)) {
        if (!out[k] && parsed[k]) out[k] = String(parsed[k]).trim() || null;
      }
    } catch {
      // ignore
    }
  }

  return out;
};

const detectSupabaseProjectRefFromClient = async (repoRoot) => {
  const p = path.join(repoRoot, "src", "integrations", "supabase", "client.ts");
  try {
    const raw = await fs.readFile(p, "utf-8");
    const m = raw.match(/DJT_QUEST_SUPABASE_PROJECT_REF\s*=\s*['"]([^'"]+)['"]/);
    if (m) return String(m[1] || "").trim() || null;
    const hostM = raw.match(/['"]([a-z0-9]+)\.supabase\.co['"]/i);
    if (hostM) return String(hostM[1] || "").trim() || null;
    return null;
  } catch {
    return null;
  }
};

const detectSupabaseConfig = async (repoRoot) => {
  const dotenv = await readDotenvSupabase(repoRoot);

  let url = normalizeUrl(firstNonEmpty(process.env.SUPABASE_URL, process.env.VITE_SUPABASE_URL, dotenv.VITE_SUPABASE_URL));

  const serviceRoleKey = firstNonEmpty(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const anonKey = firstNonEmpty(
    process.env.SUPABASE_ANON_KEY,
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    process.env.VITE_SUPABASE_ANON_KEY,
    dotenv.VITE_SUPABASE_PUBLISHABLE_KEY,
    dotenv.VITE_SUPABASE_ANON_KEY,
  );

  let host = null;
  let projectRef = null;
  if (url) {
    try {
      const u = new URL(url);
      host = u.host || null;
      const m = u.hostname.match(/^([a-z0-9]+)\.supabase\.co$/i);
      if (m) projectRef = m[1];
    } catch {
      // ignore
    }
  }

  if (!projectRef) {
    const detectedRef = await detectSupabaseProjectRefFromClient(repoRoot);
    if (detectedRef) projectRef = detectedRef;
    if (!url && detectedRef) {
      url = `https://${detectedRef}.supabase.co`;
      host = `${detectedRef}.supabase.co`;
    }
  }

  const key = serviceRoleKey || anonKey || null;
  const keyType = serviceRoleKey ? "service_role" : (key ? "anon" : "none");
  const envAnonKey = firstNonEmpty(
    process.env.SUPABASE_ANON_KEY,
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    process.env.VITE_SUPABASE_ANON_KEY,
  );
  const keySource = serviceRoleKey ? "env:SUPABASE_SERVICE_ROLE_KEY" : (envAnonKey ? "env" : (anonKey ? "dotenv" : "none"));

  return { url, host, projectRef, key, keyType, keySource };
};

const getSupabaseContext = async (repoRoot) => {
  const cfg = await detectSupabaseConfig(repoRoot);
  return {
    url: cfg.url,
    host: cfg.host,
    projectRef: cfg.projectRef,
    keyType: cfg.keyType,
    keySource: cfg.keySource,
  };
};

const getSupabaseClient = async (repoRoot) => {
  const cfg = await detectSupabaseConfig(repoRoot);
  if (!cfg.url) {
    throw new Error(
      "Missing SUPABASE_URL (configure supabase_url in .vscode/mcp.json or set VITE_SUPABASE_URL in .env.local)",
    );
  }
  if (!cfg.key) {
    throw new Error("Missing Supabase key (configure SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY)");
  }

  const client = createClient(cfg.url, cfg.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "X-Client-Info": "djt-local-mcp" } },
  });

  return { client, cfg };
};

let supabaseOpenApiCache = { url: null, at: 0, data: null };

const getSupabaseOpenApi = async (repoRoot) => {
  const cfg = await detectSupabaseConfig(repoRoot);
  if (!cfg.url) {
    throw new Error(
      "Missing SUPABASE_URL (configure supabase_url in .vscode/mcp.json or set VITE_SUPABASE_URL in .env.local)",
    );
  }
  if (!cfg.key) {
    throw new Error("Missing Supabase key (configure SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY)");
  }

  const now = Date.now();
  if (supabaseOpenApiCache.data && supabaseOpenApiCache.url === cfg.url && (now - supabaseOpenApiCache.at) < 30_000) {
    return { openapi: supabaseOpenApiCache.data, cfg };
  }

  const openapi = await fetchJson(`${cfg.url}/rest/v1/`, {
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      Accept: "application/openapi+json",
    },
    timeoutMs: 25_000,
  });

  supabaseOpenApiCache = { url: cfg.url, at: now, data: openapi };
  return { openapi, cfg };
};

const applySupabaseFilters = (query, filters) => {
  const list = Array.isArray(filters) ? filters : [];
  for (const f of list) {
    const column = String(f?.column || "").trim();
    const operator = String(f?.operator || "").trim();
    const value = f?.value;
    if (!column) throw new Error("Filtro inválido: column obrigatório");
    if (!operator) throw new Error("Filtro inválido: operator obrigatório");

    switch (operator) {
      case "eq":
        query = query.eq(column, value);
        break;
      case "neq":
        query = query.neq(column, value);
        break;
      case "gt":
        query = query.gt(column, value);
        break;
      case "gte":
        query = query.gte(column, value);
        break;
      case "lt":
        query = query.lt(column, value);
        break;
      case "lte":
        query = query.lte(column, value);
        break;
      case "like":
        query = query.like(column, String(value ?? ""));
        break;
      case "ilike":
        query = query.ilike(column, String(value ?? ""));
        break;
      case "in": {
        const values = Array.isArray(value)
          ? value
          : (typeof value === "string" ? value.split(",").map((s) => s.trim()).filter(Boolean) : [value]);
        query = query.in(column, values);
        break;
      }
      case "is":
        query = query.is(column, value);
        break;
      default:
        throw new Error(`Filtro inválido: operator desconhecido (${operator})`);
    }
  }
  return query;
};

const githubApi = async (repoRoot, pathWithQuery, opts = {}) => {
  const token = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "").trim();
  if (!token) throw new Error("Missing GITHUB_TOKEN (configure it in .vscode/mcp.json)");

  const base = "https://api.github.com";
  const url = `${base}${pathWithQuery}`;
  return await fetchJson(url, {
    ...opts,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${token}`,
      ...(opts.headers || {}),
    },
  });
};

const vercelApi = async (repoRoot, pathWithQuery, opts = {}) => {
  const token = String(process.env.VERCEL_TOKEN || "").trim();
  if (!token) throw new Error("Missing VERCEL_TOKEN (configure it in .vscode/mcp.json)");

  const base = "https://api.vercel.com";
  const url = `${base}${pathWithQuery}`;
  return await fetchJson(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(opts.headers || {}),
    },
  });
};

const server = new Server(
  { name: "djt-local", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "djt.context",
      description: "Detecta contexto do workspace (repo GitHub + Vercel project/org).",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "djt.comment_pr_with_latest_vercel_preview",
      description:
        "Comenta no PR com o preview mais recente do Vercel (tenta casar branch/sha do PR com deployments do projeto).",
      inputSchema: {
        type: "object",
        properties: {
          pullNumber: { type: "number" },
          repo: { type: "string", description: "owner/repo (opcional)" },
          projectId: { type: "string" },
          teamId: { type: "string" },
          searchLimit: { type: "number", default: 25 },
        },
        required: ["pullNumber"],
        additionalProperties: false,
      },
    },
    {
      name: "github.list_pull_requests",
      description: "Lista PRs do repo (default: repo detectado pelo remote origin).",
      inputSchema: {
        type: "object",
        properties: {
          repo: { type: "string", description: "owner/repo (opcional)" },
          state: { type: "string", enum: ["open", "closed", "all"], default: "open" },
          perPage: { type: "number", default: 10 },
          page: { type: "number", default: 1 },
        },
        additionalProperties: false,
      },
    },
    {
      name: "github.create_issue",
      description: "Cria uma issue no repo.",
      inputSchema: {
        type: "object",
        properties: {
          repo: { type: "string", description: "owner/repo (opcional)" },
          title: { type: "string" },
          body: { type: "string" },
          labels: { type: "array", items: { type: "string" } },
        },
        required: ["title"],
        additionalProperties: false,
      },
    },
    {
      name: "github.create_pull_request",
      description: "Cria um Pull Request no GitHub.",
      inputSchema: {
        type: "object",
        properties: {
          repo: { type: "string", description: "owner/repo (opcional)" },
          title: { type: "string" },
          head: { type: "string", description: "branch head (ex.: feat/x)" },
          base: { type: "string", description: "branch base (default: main)" },
          body: { type: "string" },
          draft: { type: "boolean", default: false },
        },
        required: ["title", "head"],
        additionalProperties: false,
      },
    },
    {
      name: "vercel.list_deployments",
      description: "Lista deployments do projeto Vercel (detecta projectId via .vercel/project.json).",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          teamId: { type: "string" },
          limit: { type: "number", default: 10 },
        },
        additionalProperties: false,
      },
    },
    {
      name: "vercel.get_deployment",
      description: "Busca detalhes de um deployment Vercel por id.",
      inputSchema: {
        type: "object",
        properties: { deploymentId: { type: "string" } },
        required: ["deploymentId"],
        additionalProperties: false,
      },
    },
	    {
	      name: "vercel.get_project",
	      description: "Busca detalhes do projeto Vercel (detecta projectId via .vercel/project.json).",
	      inputSchema: {
	        type: "object",
	        properties: { projectId: { type: "string" }, teamId: { type: "string" } },
	        additionalProperties: false,
	      },
	    },
	    {
	      name: "supabase.context",
	      description: "Detecta Supabase URL e disponibilidade de chaves (sem expor secrets).",
	      inputSchema: { type: "object", properties: {}, additionalProperties: false },
	    },
	    {
	      name: "supabase.list_tables",
	      description: "Lista tabelas e RPCs expostos pelo PostgREST (via OpenAPI em /rest/v1/).",
	      inputSchema: {
	        type: "object",
	        properties: {
	          maxTables: { type: "number", default: 200 },
	          maxRpcs: { type: "number", default: 200 },
	        },
	        additionalProperties: false,
	      },
	    },
	    {
	      name: "supabase.describe_table",
	      description: "Mostra o schema OpenAPI de uma tabela (colunas/tipos), se disponível.",
	      inputSchema: {
	        type: "object",
	        properties: { table: { type: "string" } },
	        required: ["table"],
	        additionalProperties: false,
	      },
	    },
	    {
	      name: "supabase.table_select",
	      description: "Select (somente leitura) em uma tabela via Supabase/PostgREST.",
	      inputSchema: {
	        type: "object",
	        properties: {
	          schema: { type: "string", default: "public" },
	          table: { type: "string" },
	          select: { type: "string", default: "*" },
	          filters: {
	            type: "array",
	            items: {
	              type: "object",
	              properties: {
	                column: { type: "string" },
	                operator: {
	                  type: "string",
	                  enum: ["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in", "is"],
	                },
	                value: {},
	              },
	              required: ["column", "operator"],
	              additionalProperties: false,
	            },
	          },
	          orderBy: {
	            type: "object",
	            properties: {
	              column: { type: "string" },
	              ascending: { type: "boolean", default: true },
	              nullsFirst: { type: "boolean" },
	            },
	            required: ["column"],
	            additionalProperties: false,
	          },
	          limit: { type: "number", default: 50 },
	          offset: { type: "number", default: 0 },
	          withCount: { type: "boolean", default: false },
	        },
	        required: ["table"],
	        additionalProperties: false,
	      },
	    },
	    {
	      name: "supabase.table_count",
	      description: "Count (somente leitura) de linhas em uma tabela, com filtros opcionais.",
	      inputSchema: {
	        type: "object",
	        properties: {
	          schema: { type: "string", default: "public" },
	          table: { type: "string" },
	          filters: {
	            type: "array",
	            items: {
	              type: "object",
	              properties: {
	                column: { type: "string" },
	                operator: {
	                  type: "string",
	                  enum: ["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in", "is"],
	                },
	                value: {},
	              },
	              required: ["column", "operator"],
	              additionalProperties: false,
	            },
	          },
	        },
	        required: ["table"],
	        additionalProperties: false,
	      },
	    },
	    {
	      name: "supabase.storage.list_buckets",
	      description: "Lista buckets do Supabase Storage (somente leitura).",
	      inputSchema: { type: "object", properties: {}, additionalProperties: false },
	    },
	    {
	      name: "supabase.storage.list_objects",
	      description: "Lista objetos em um bucket do Supabase Storage (somente leitura).",
	      inputSchema: {
	        type: "object",
	        properties: {
	          bucket: { type: "string" },
	          prefix: { type: "string" },
	          limit: { type: "number", default: 100 },
	          offset: { type: "number", default: 0 },
	        },
	        required: ["bucket"],
	        additionalProperties: false,
	      },
	    },
	    {
	      name: "supabase.storage.create_signed_url",
	      description: "Gera uma signed URL de leitura para um objeto no Storage.",
	      inputSchema: {
	        type: "object",
	        properties: {
	          bucket: { type: "string" },
	          path: { type: "string" },
	          expiresIn: { type: "number", default: 3600 },
	        },
	        required: ["bucket", "path"],
	        additionalProperties: false,
	      },
	    },
	  ],
	}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = String(req.params?.name || "");
  const args = (req.params?.arguments && typeof req.params.arguments === "object") ? req.params.arguments : {};

  try {
    const repoRoot = await findRepoRoot(process.cwd());

	    if (name === "djt.context") {
	      const github = await detectGitHubRepo(repoRoot);
	      const vercel = await detectVercelProject(repoRoot);
	      const supabase = await getSupabaseContext(repoRoot);
	      return okText({ repoRoot, github, vercel, supabase });
	    }

    if (name === "djt.comment_pr_with_latest_vercel_preview") {
      const pullNumber = Number(args?.pullNumber);
      if (!Number.isFinite(pullNumber) || pullNumber <= 0) throw new Error("pullNumber inválido");

      let repo = String(args?.repo || "").trim();
      if (!repo) {
        const detected = await detectGitHubRepo(repoRoot);
        if (!detected) throw new Error("Repo GitHub não detectado (configure GITHUB_REPO ou remote origin).");
        repo = `${detected.owner}/${detected.repo}`;
      }
      const [owner, repoName] = repo.split("/", 2);

      const ctx = await detectVercelProject(repoRoot);
      const projectId = String(args?.projectId || ctx.projectId || "").trim();
      const teamId = String(args?.teamId || ctx.orgId || "").trim();
      if (!projectId) throw new Error("projectId não detectado (link o projeto com `vercel link` ou passe projectId).");

      const pr = await githubApi(repoRoot, `/repos/${owner}/${repoName}/pulls/${pullNumber}`);
      const headRef = String(pr?.head?.ref || "").trim();
      const headSha = String(pr?.head?.sha || "").trim();
      if (!headRef && !headSha) throw new Error("Não foi possível detectar head.ref/head.sha do PR.");

      const limit = Math.max(5, Math.min(50, Number(args?.searchLimit) || 25));
      const params = new URLSearchParams();
      params.set("projectId", projectId);
      params.set("limit", String(limit));
      if (teamId) params.set("teamId", teamId);
      const depResp = await vercelApi(repoRoot, `/v6/deployments?${params.toString()}`);
      const deployments = Array.isArray(depResp?.deployments) ? depResp.deployments : [];

      const norm = (s) => String(s || "").trim().toLowerCase();
      const wantSha = norm(headSha);
      const wantRef = norm(headRef);

      const found = deployments.find((d) => {
        const git = d?.gitSource && typeof d.gitSource === "object" ? d.gitSource : {};
        const meta = d?.meta && typeof d.meta === "object" ? d.meta : {};
        const sha = norm(git?.sha || meta?.githubCommitSha || meta?.githubCommitSHA || meta?.GITHUB_COMMIT_SHA || "");
        const ref = norm(git?.ref || meta?.githubCommitRef || meta?.githubCommitRefName || meta?.GITHUB_COMMIT_REF || "");
        if (wantSha && sha && sha === wantSha) return true;
        if (wantRef && ref && ref === wantRef) return true;
        return false;
      });

      if (!found) {
        return okText({
          ok: false,
          reason: "Nenhum deployment encontrado para este PR (tente aumentar searchLimit).",
          pr: { number: pr?.number, url: pr?.html_url, headRef, headSha },
          vercel: { projectId, teamId, searched: deployments.length },
        });
      }

      const deploymentId = String(found?.uid || found?.id || "").trim();
      const deploymentHost = String(found?.url || "").trim();
      const previewUrl = deploymentHost ? `https://${deploymentHost}` : null;

      const bodyLines = [
        "Preview Vercel (auto):",
        previewUrl ? previewUrl : "(sem url)",
        deploymentId ? `deployment: ${deploymentId}` : null,
        headRef ? `branch: ${headRef}` : null,
        headSha ? `sha: ${headSha}` : null,
      ].filter(Boolean);

      const comment = await githubApi(repoRoot, `/repos/${owner}/${repoName}/issues/${pullNumber}/comments`, {
        method: "POST",
        body: { body: bodyLines.join("\n") },
      });

      return okText({
        ok: true,
        previewUrl,
        deploymentId,
        commentUrl: comment?.html_url || null,
      });
    }

    if (name === "github.list_pull_requests") {
      const state = String(args?.state || "open");
      const perPage = Math.max(1, Math.min(100, Number(args?.perPage) || 10));
      const page = Math.max(1, Number(args?.page) || 1);

      let repo = String(args?.repo || "").trim();
      if (!repo) {
        const detected = await detectGitHubRepo(repoRoot);
        if (!detected) throw new Error("Repo GitHub não detectado (configure GITHUB_REPO ou remote origin).");
        repo = `${detected.owner}/${detected.repo}`;
      }
      const [owner, repoName] = repo.split("/", 2);
      const items = await githubApi(repoRoot, `/repos/${owner}/${repoName}/pulls?state=${encodeURIComponent(state)}&per_page=${perPage}&page=${page}`);
      const list = Array.isArray(items) ? items : [];
      return okText(
        list.map((p) => ({
          number: p.number,
          title: p.title,
          state: p.state,
          draft: p.draft,
          user: p.user?.login,
          html_url: p.html_url,
          head: p.head?.ref,
          base: p.base?.ref,
        })),
      );
    }

    if (name === "github.create_issue") {
      const title = String(args?.title || "").trim();
      if (!title) throw new Error("title obrigatório");
      const body = args?.body == null ? undefined : String(args.body);
      const labels = Array.isArray(args?.labels) ? args.labels.map((s) => String(s)).filter(Boolean) : undefined;

      let repo = String(args?.repo || "").trim();
      if (!repo) {
        const detected = await detectGitHubRepo(repoRoot);
        if (!detected) throw new Error("Repo GitHub não detectado (configure GITHUB_REPO ou remote origin).");
        repo = `${detected.owner}/${detected.repo}`;
      }
      const [owner, repoName] = repo.split("/", 2);

      const created = await githubApi(repoRoot, `/repos/${owner}/${repoName}/issues`, {
        method: "POST",
        body: { title, body, labels },
      });
      return okText({ number: created?.number, url: created?.html_url, title: created?.title });
    }

    if (name === "github.create_pull_request") {
      const title = String(args?.title || "").trim();
      const head = String(args?.head || "").trim();
      const base = String(args?.base || "main").trim() || "main";
      const body = args?.body == null ? undefined : String(args.body);
      const draft = Boolean(args?.draft);
      if (!title) throw new Error("title obrigatório");
      if (!head) throw new Error("head obrigatório");

      let repo = String(args?.repo || "").trim();
      if (!repo) {
        const detected = await detectGitHubRepo(repoRoot);
        if (!detected) throw new Error("Repo GitHub não detectado (configure GITHUB_REPO ou remote origin).");
        repo = `${detected.owner}/${detected.repo}`;
      }
      const [owner, repoName] = repo.split("/", 2);

      const created = await githubApi(repoRoot, `/repos/${owner}/${repoName}/pulls`, {
        method: "POST",
        body: { title, head, base, body, draft },
      });
      return okText({ number: created?.number, url: created?.html_url, title: created?.title });
    }

    if (name === "vercel.list_deployments") {
      const ctx = await detectVercelProject(repoRoot);
      const projectId = String(args?.projectId || ctx.projectId || "").trim();
      const teamId = String(args?.teamId || ctx.orgId || "").trim();
      const limit = Math.max(1, Math.min(50, Number(args?.limit) || 10));
      if (!projectId) throw new Error("projectId não detectado (link o projeto com `vercel link` ou passe projectId).");

      const params = new URLSearchParams();
      params.set("projectId", projectId);
      params.set("limit", String(limit));
      if (teamId) params.set("teamId", teamId);
      const data = await vercelApi(repoRoot, `/v6/deployments?${params.toString()}`);
      const deployments = Array.isArray(data?.deployments) ? data.deployments : [];
      return okText(
        deployments.map((d) => ({
          id: d.uid || d.id,
          url: d.url ? `https://${d.url}` : null,
          state: d.state || d.readyState,
          createdAt: d.createdAt,
          name: d.name || null,
          meta: d.meta || null,
          gitSource: d.gitSource || null,
        })),
      );
    }

    if (name === "vercel.get_deployment") {
      const deploymentId = String(args?.deploymentId || "").trim();
      if (!deploymentId) throw new Error("deploymentId obrigatório");
      const data = await vercelApi(repoRoot, `/v13/deployments/${encodeURIComponent(deploymentId)}`);
      return okText(data);
    }

	    if (name === "vercel.get_project") {
	      const ctx = await detectVercelProject(repoRoot);
	      const projectId = String(args?.projectId || ctx.projectId || "").trim();
	      const teamId = String(args?.teamId || ctx.orgId || "").trim();
	      if (!projectId) throw new Error("projectId não detectado (link o projeto com `vercel link` ou passe projectId).");

      const params = new URLSearchParams();
      if (teamId) params.set("teamId", teamId);
      const qs = params.toString();
	      const data = await vercelApi(repoRoot, `/v9/projects/${encodeURIComponent(projectId)}${qs ? `?${qs}` : ""}`);
	      return okText(data);
	    }

	    if (name === "supabase.context") {
	      const supabase = await getSupabaseContext(repoRoot);
	      return okText(supabase);
	    }

	    if (name === "supabase.list_tables") {
	      const maxTables = Math.max(0, Math.min(2000, Number(args?.maxTables) || 200));
	      const maxRpcs = Math.max(0, Math.min(2000, Number(args?.maxRpcs) || 200));
	      const { openapi, cfg } = await getSupabaseOpenApi(repoRoot);
	      const paths = openapi && typeof openapi === "object" && openapi.paths && typeof openapi.paths === "object" ? openapi.paths : {};

	      const tables = [];
	      const rpcs = [];
	      for (const p of Object.keys(paths)) {
	        const tableM = p.match(/^\/([^/]+)$/);
	        if (tableM && tableM[1] && tableM[1] !== "rpc") tables.push(tableM[1]);
	        const rpcM = p.match(/^\/rpc\/([^/]+)$/);
	        if (rpcM && rpcM[1]) rpcs.push(rpcM[1]);
	      }

	      tables.sort();
	      rpcs.sort();

	      return okText({
	        url: cfg.url,
	        keyType: cfg.keyType,
	        totalPaths: Object.keys(paths).length,
	        tables: tables.slice(0, maxTables),
	        rpcs: rpcs.slice(0, maxRpcs),
	      });
	    }

	    if (name === "supabase.describe_table") {
	      const input = String(args?.table || "").trim();
	      if (!input) throw new Error("table obrigatório");
	      const table = input.includes(".") ? input.split(".").pop() : input;
	      if (!table) throw new Error("table inválido");

	      const { openapi, cfg } = await getSupabaseOpenApi(repoRoot);
	      const schemas =
	        openapi && typeof openapi === "object" && openapi.components && typeof openapi.components === "object"
	          && openapi.components.schemas && typeof openapi.components.schemas === "object"
	          ? openapi.components.schemas
	          : (openapi && typeof openapi === "object" && openapi.definitions && typeof openapi.definitions === "object" ? openapi.definitions : {});

	      const want = table.toLowerCase();
	      let schemaName = table in schemas ? table : null;
	      if (!schemaName) {
	        for (const k of Object.keys(schemas)) {
	          if (String(k).toLowerCase() === want) {
	            schemaName = k;
	            break;
	          }
	        }
	      }

	      const schema = schemaName ? schemas[schemaName] : null;
	      const props = schema && typeof schema === "object" && schema.properties && typeof schema.properties === "object"
	        ? schema.properties
	        : null;
	      const columns = props
	        ? Object.fromEntries(
	          Object.entries(props).map(([col, def]) => ([
	            col,
	            {
	              type: def && typeof def === "object" ? def.type ?? null : null,
	              format: def && typeof def === "object" ? def.format ?? null : null,
	              nullable: def && typeof def === "object" ? def.nullable ?? null : null,
	            },
	          ])),
	        )
	        : null;

	      const rest = openapi && typeof openapi === "object" && openapi.paths && typeof openapi.paths === "object"
	        ? openapi.paths[`/${table}`] ?? null
	        : null;
	      const restGet = rest && typeof rest === "object" ? rest.get ?? null : null;

	      return okText({
	        url: cfg.url,
	        keyType: cfg.keyType,
	        table,
	        schemaName,
	        required: schema && typeof schema === "object" && Array.isArray(schema.required) ? schema.required : null,
	        columns,
	        restGet,
	      });
	    }

	    if (name === "supabase.table_select") {
	      const schema = String(args?.schema || "public").trim() || "public";
	      const table = String(args?.table || "").trim();
	      const select = String(args?.select || "*").trim() || "*";
	      const withCount = Boolean(args?.withCount);
	      const limit = Math.max(1, Math.min(500, Number(args?.limit) || 50));
	      const offset = Math.max(0, Math.min(10000, Number(args?.offset) || 0));
	      if (!table) throw new Error("table obrigatório");

	      const { client, cfg } = await getSupabaseClient(repoRoot);
	      const selectOpts = withCount ? { count: "exact" } : undefined;
	      let query = client.schema(schema).from(table).select(select, selectOpts);
	      query = applySupabaseFilters(query, args?.filters);

	      if (args?.orderBy && typeof args.orderBy === "object") {
	        const col = String(args.orderBy.column || "").trim();
	        if (col) {
	          query = query.order(col, {
	            ascending: args.orderBy.ascending !== false,
	            ...(args.orderBy.nullsFirst == null ? {} : { nullsFirst: Boolean(args.orderBy.nullsFirst) }),
	          });
	        }
	      }

	      query = offset ? query.range(offset, offset + limit - 1) : query.limit(limit);
	      const { data, error, count } = await query;
	      if (error) throw new Error(error.message);
	      return okText({ url: cfg.url, keyType: cfg.keyType, schema, table, count: count ?? null, data });
	    }

	    if (name === "supabase.table_count") {
	      const schema = String(args?.schema || "public").trim() || "public";
	      const table = String(args?.table || "").trim();
	      if (!table) throw new Error("table obrigatório");

	      const { client, cfg } = await getSupabaseClient(repoRoot);
	      let query = client.schema(schema).from(table).select("*", { count: "exact", head: true });
	      query = applySupabaseFilters(query, args?.filters);
	      const { error, count } = await query;
	      if (error) throw new Error(error.message);
	      return okText({ url: cfg.url, keyType: cfg.keyType, schema, table, count: count ?? null });
	    }

	    if (name === "supabase.storage.list_buckets") {
	      const { client, cfg } = await getSupabaseClient(repoRoot);
	      const { data, error } = await client.storage.listBuckets();
	      if (error) throw new Error(error.message);
	      const list = Array.isArray(data) ? data : [];
	      return okText({
	        url: cfg.url,
	        keyType: cfg.keyType,
	        buckets: list.map((b) => ({
	          id: b.id,
	          name: b.name,
	          public: b.public,
	          created_at: b.created_at,
	          updated_at: b.updated_at,
	        })),
	      });
	    }

	    if (name === "supabase.storage.list_objects") {
	      const bucket = String(args?.bucket || "").trim();
	      if (!bucket) throw new Error("bucket obrigatório");
	      const prefix = args?.prefix == null ? undefined : String(args.prefix);
	      const limit = Math.max(1, Math.min(1000, Number(args?.limit) || 100));
	      const offset = Math.max(0, Math.min(10000, Number(args?.offset) || 0));

	      const { client, cfg } = await getSupabaseClient(repoRoot);
	      const { data, error } = await client.storage.from(bucket).list(prefix, {
	        limit,
	        offset,
	        sortBy: { column: "name", order: "asc" },
	      });
	      if (error) throw new Error(error.message);
	      return okText({ url: cfg.url, keyType: cfg.keyType, bucket, prefix: prefix ?? null, items: data ?? [] });
	    }

	    if (name === "supabase.storage.create_signed_url") {
	      const bucket = String(args?.bucket || "").trim();
	      const filePath = String(args?.path || "").trim();
	      if (!bucket) throw new Error("bucket obrigatório");
	      if (!filePath) throw new Error("path obrigatório");
	      const expiresIn = Math.max(60, Math.min(604_800, Number(args?.expiresIn) || 3600));

	      const { client, cfg } = await getSupabaseClient(repoRoot);
	      const { data, error } = await client.storage.from(bucket).createSignedUrl(filePath, expiresIn);
	      if (error) throw new Error(error.message);
	      return okText({ url: cfg.url, keyType: cfg.keyType, bucket, path: filePath, expiresIn, signedUrl: data?.signedUrl || null });
	    }

	    throw new Error(`Unknown tool: ${name}`);
	  } catch (e) {
	    if (isAbortError(e)) return safeError("Request aborted");
	    return safeError(e);
	  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
