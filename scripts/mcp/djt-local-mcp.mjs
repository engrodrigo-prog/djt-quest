#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
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
      return okText({ repoRoot, github, vercel });
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

    throw new Error(`Unknown tool: ${name}`);
  } catch (e) {
    if (isAbortError(e)) return safeError("Request aborted");
    return safeError(e);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
