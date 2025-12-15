import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import { toast } from "sonner";

type StudySourceRow = {
  id: string;
  user_id: string;
  title: string | null;
  kind: string | null;
  url: string | null;
  storage_path: string | null;
  topic: string | null;
  ingest_status: string | null;
  is_persistent: boolean;
  created_at: string;
  last_used_at: string | null;
};

const APP_LOCAL_KEYS = ["auth_user_cache", "auth_role_override", "studio_compendium_draft"];
const XP_ADMIN_EMAILS = new Set([
  "rodrigonasc@cpfl.com.br",
  "cveiga@cpfl.com.br",
  "rodrigoalmeida@cpfl.com.br",
  "paulo.camara@cpfl.com.br",
]);
const XP_ADMIN_MATRICULAS = new Set(["601555", "3005597", "866776", "2011902"]);

const clearLocalCache = (opts?: { clearSupabaseTokens?: boolean }) => {
  const clearSupabaseTokens = Boolean(opts?.clearSupabaseTokens);
  try {
    for (const k of APP_LOCAL_KEYS) localStorage.removeItem(k);
  } catch {
    // ignore
  }
  if (clearSupabaseTokens) {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k.startsWith("sb-") && k.includes("-auth-token")) keysToRemove.push(k);
        if (k.startsWith("supabase.") || k.startsWith("supabase-auth")) keysToRemove.push(k);
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
    } catch {
      // ignore
    }
  }
};

export const StudioMaintenance = () => {
  const { profile } = useAuth() as any;
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<StudySourceRow[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [isAdmin, setIsAdmin] = useState(false);
  const canAdjustXp =
    XP_ADMIN_EMAILS.has(String(profile?.email || "").toLowerCase()) ||
    XP_ADMIN_MATRICULAS.has(String(profile?.matricula || "").trim());

  const [userSearch, setUserSearch] = useState("");
  const [usersLoading, setUsersLoading] = useState(false);
  const [userResults, setUserResults] = useState<Array<{ id: string; name: string; email: string | null; matricula: string | null; xp: number; tier: string }>>([]);
  const [selectedUser, setSelectedUser] = useState<{ id: string; name: string; email: string | null; matricula: string | null; xp: number; tier: string } | null>(null);
  const [xpToSet, setXpToSet] = useState<number>(0);

  const selectedIds = useMemo(() => Object.keys(selected).filter((k) => selected[k]), [selected]);
  const allSelected = selectedIds.length > 0 && selectedIds.length === items.length;

  const load = async () => {
    setLoading(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      params.set("limit", "200");
      params.set("scope", scope);
      const resp = await apiFetch(`/api/admin?handler=admin-study-sources&${params.toString()}`, {
        method: "GET",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || "Falha ao carregar fontes");
      setItems(Array.isArray(json.items) ? json.items : []);
      setIsAdmin(Boolean(json.isAdmin));
      setSelected({});
    } catch (e: any) {
      toast.error(e?.message || "Falha ao carregar fontes");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const toggleAll = () => {
    if (!items.length) return;
    if (allSelected) {
      setSelected({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const it of items) next[it.id] = true;
    setSelected(next);
  };

  const deleteSelected = async () => {
    if (!selectedIds.length) {
      toast("Selecione ao menos 1 item para excluir.");
      return;
    }
    const ok = window.confirm(`Excluir ${selectedIds.length} item(ns) do catálogo? Isso remove o material da base de estudos.`)
    if (!ok) return;
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const resp = await apiFetch(`/api/admin?handler=admin-study-sources`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ action: "delete", ids: selectedIds, deleteStorage: true }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || "Falha ao excluir");
      toast.success(`Excluídos: ${json.deleted || selectedIds.length}`);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Falha ao excluir");
    }
  };

  const clearCacheOnly = () => {
    clearLocalCache({ clearSupabaseTokens: false });
    toast.success("Cache do app limpo (sem sair).");
  };

  const clearSessionAndReload = async () => {
    const ok = window.confirm("Sair, limpar sessão local e recarregar a página?");
    if (!ok) return;
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
    clearLocalCache({ clearSupabaseTokens: true });
    window.location.reload();
  };

  const searchUsers = async () => {
    if (!canAdjustXp) {
      toast.error("Sem permissão para ajustar XP manualmente.");
      return;
    }
    const q = userSearch.trim();
    if (!q) {
      toast("Digite nome, matrícula ou e-mail para buscar.");
      return;
    }
    setUsersLoading(true);
    try {
      const clauses = [
        `name.ilike.%${q}%`,
        `email.ilike.%${q}%`,
        `matricula.ilike.%${q}%`,
      ];
      if (/^\\d+$/.test(q)) clauses.unshift(`matricula.eq.${q}`);

      const { data, error } = await supabase
        .from("profiles")
        .select("id,name,email,matricula,xp,tier")
        .or(clauses.join(","))
        .limit(30);
      if (error) throw error;
      const list = (data || []).map((u: any) => ({
        id: u.id,
        name: u.name,
        email: u.email ?? null,
        matricula: u.matricula ?? null,
        xp: Number(u.xp ?? 0),
        tier: u.tier,
      }));
      setUserResults(list);
      if (!list.length) toast("Nenhum usuário encontrado.");
    } catch (e: any) {
      toast.error(e?.message || "Falha ao buscar usuários");
    } finally {
      setUsersLoading(false);
    }
  };

  const applyXp = async (action: "set" | "reset") => {
    if (!canAdjustXp) {
      toast.error("Sem permissão para ajustar XP manualmente.");
      return;
    }
    if (!selectedUser) {
      toast("Selecione um usuário.");
      return;
    }
    if (action === "set") {
      const n = Number(xpToSet);
      if (!Number.isFinite(n) || n < 0 || n > 1_000_000) {
        toast("Defina um XP entre 0 e 1.000.000.");
        return;
      }
    }
    const ok = window.confirm(
      action === "reset"
        ? `Zerar XP de ${selectedUser.name} (${selectedUser.matricula || "sem matrícula"})?`
        : `Definir XP de ${selectedUser.name} (${selectedUser.matricula || "sem matrícula"}) para ${Number(xpToSet).toLocaleString()}?`,
    );
    if (!ok) return;

    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const resp = await apiFetch("/api/admin?handler=admin-adjust-xp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          action,
          user_id: selectedUser.id,
          xp: action === "set" ? Number(xpToSet) : 0,
        }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || "Falha ao ajustar XP");
      const u = json?.user;
      toast.success(`XP atualizado: ${u?.name || selectedUser.name} → ${Number(u?.new_xp ?? 0).toLocaleString()} (${u?.new_tier || ""})`);
      const next = {
        ...selectedUser,
        xp: Number(u?.new_xp ?? selectedUser.xp),
        tier: String(u?.new_tier ?? selectedUser.tier),
      };
      setSelectedUser(next);
      setUserResults((prev) => prev.map((p) => (p.id === next.id ? next : p)));
    } catch (e: any) {
      toast.error(e?.message || "Falha ao ajustar XP");
    }
  };

  return (
    <div className="space-y-6">
      <Card className="bg-white/5 border border-white/20 text-white shadow-lg backdrop-blur-md">
        <CardHeader>
          <CardTitle className="text-white">Manutenção • Sessão</CardTitle>
          <CardDescription className="text-white/80">
            Use para limpar cache do Studio e/ou encerrar a sessão local (útil quando um tema antigo “gruda”).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-3">
          <Button type="button" variant="outline" onClick={clearCacheOnly} className="border-white/30 text-white">
            Limpar cache do app
          </Button>
          <Button type="button" variant="destructive" onClick={clearSessionAndReload}>
            Sair + limpar sessão + recarregar
          </Button>
        </CardContent>
      </Card>

      {canAdjustXp && (
        <Card className="bg-white/5 border border-white/20 text-white shadow-lg backdrop-blur-md">
          <CardHeader>
            <CardTitle className="text-white">Manutenção • Pontuação (XP)</CardTitle>
            <CardDescription className="text-white/80">
              Ajuste manual de XP (zerar/definir) para corrigir casos de pontuação fora de escala.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2 space-y-2">
                <Label className="text-white">Buscar usuário</Label>
                <div className="flex gap-2">
                  <Input
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Nome, matrícula ou e-mail"
                    className="bg-white/10 border-white/20 text-white placeholder:text-white/60"
                  />
                  <Button type="button" variant="outline" className="border-white/30 text-white" onClick={searchUsers} disabled={usersLoading}>
                    {usersLoading ? "Buscando..." : "Buscar"}
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-white">Definir XP</Label>
                <Input
                  type="number"
                  min={0}
                  max={1_000_000}
                  value={xpToSet}
                  onChange={(e) => setXpToSet(Number(e.target.value) || 0)}
                  className="bg-white/10 border-white/20 text-white placeholder:text-white/60"
                />
              </div>
            </div>

            {userResults.length > 0 && (
              <div className="rounded-lg border border-white/15 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-white/80">Usuário</TableHead>
                      <TableHead className="text-white/80">Matrícula</TableHead>
                      <TableHead className="text-white/80">XP</TableHead>
                      <TableHead className="text-white/80">Tier</TableHead>
                      <TableHead className="text-white/80 text-right">Ação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {userResults.map((u) => (
                      <TableRow key={u.id} className={u.id === selectedUser?.id ? "bg-white/5" : undefined}>
                        <TableCell className="text-white">
                          <div className="flex flex-col">
                            <span className="font-medium">{u.name}</span>
                            <span className="text-[11px] text-white/70">{u.email || "sem e-mail"}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-white/90">{u.matricula || "-"}</TableCell>
                        <TableCell className="text-white/90">{Number(u.xp || 0).toLocaleString()}</TableCell>
                        <TableCell className="text-white/90">
                          <Badge variant="secondary">{u.tier}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="border-white/30 text-white"
                            onClick={() => {
                              setSelectedUser(u);
                              setXpToSet(Number(u.xp || 0));
                            }}
                          >
                            Selecionar
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {selectedUser && (
              <div className="flex flex-col md:flex-row gap-2 md:items-center md:justify-between rounded-lg border border-white/15 p-3 bg-white/5">
                <div className="text-sm">
                  <p className="font-semibold text-white">{selectedUser.name}</p>
                  <p className="text-white/70 text-xs">
                    {selectedUser.matricula || "sem matrícula"} • XP atual: {Number(selectedUser.xp || 0).toLocaleString()} • {selectedUser.tier}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="destructive" onClick={() => applyXp("reset")}>
                    Zerar XP
                  </Button>
                  <Button type="button" variant="default" onClick={() => applyXp("set")}>
                    Definir XP
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="bg-white/5 border border-white/20 text-white shadow-lg backdrop-blur-md">
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-white">Manutenção • Uploads / Bases de estudo</CardTitle>
              <CardDescription className="text-white/80">
                Remova materiais antigos (ex.: “alagadas”, “GED 22”) para evitar que apareçam na curadoria e geração.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" className="border-white/30 text-white" onClick={load} disabled={loading}>
                {loading ? "Atualizando..." : "Atualizar"}
              </Button>
              <Button type="button" variant="destructive" onClick={deleteSelected} disabled={loading || selectedIds.length === 0}>
                Excluir selecionados ({selectedIds.length})
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2 space-y-2">
              <Label className="text-white">Buscar</Label>
              <div className="flex gap-2">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder='Ex.: alagadas, GED 22, NR10...'
                  className="bg-white/10 border-white/20 text-white placeholder:text-white/60"
                />
                <Button type="button" variant="outline" className="border-white/30 text-white" onClick={load} disabled={loading}>
                  Filtrar
                </Button>
              </div>
              <p className="text-[11px] text-white/70">
                Dica: filtre por um termo e selecione tudo para excluir em lote.
              </p>
            </div>
            <div className="space-y-2">
              <Label className="text-white">Escopo</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={scope === "all" ? "default" : "outline"}
                  className={scope === "all" ? "bg-primary text-primary-foreground" : "border-white/30 text-white"}
                  onClick={() => setScope("all")}
                  disabled={!isAdmin}
                  title={!isAdmin ? "Somente admins podem ver o catálogo completo" : "Catálogo completo"}
                >
                  Todos
                </Button>
                <Button
                  type="button"
                  variant={scope === "mine" ? "default" : "outline"}
                  className={scope === "mine" ? "bg-primary text-primary-foreground" : "border-white/30 text-white"}
                  onClick={() => setScope("mine")}
                >
                  Meus
                </Button>
              </div>
              {!isAdmin && (
                <p className="text-[11px] text-white/70">
                  Você está no modo “Meus” por permissão.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-white/20 overflow-hidden">
            <Table className="text-white">
              <TableHeader>
                <TableRow className="border-white/20">
                  <TableHead className="text-white/70 w-[60px]">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                  </TableHead>
                  <TableHead className="text-white/70">Título</TableHead>
                  <TableHead className="text-white/70 w-[120px]">Tipo</TableHead>
                  <TableHead className="text-white/70 w-[180px]">Criado</TableHead>
                  <TableHead className="text-white/70 w-[130px]">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 && (
                  <TableRow className="border-white/20">
                    <TableCell colSpan={5} className="text-white/70">
                      {loading ? "Carregando..." : "Nenhum item encontrado."}
                    </TableCell>
                  </TableRow>
                )}
                {items.map((it) => {
                  const checked = Boolean(selected[it.id]);
                  const title = (it.title || it.url || it.id).toString();
                  const created = it.created_at ? new Date(it.created_at).toLocaleString("pt-BR") : "-";
                  const status = it.ingest_status || "ok";
                  return (
                    <TableRow key={it.id} className="border-white/20">
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => setSelected((prev) => ({ ...prev, [it.id]: e.target.checked }))}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="font-semibold leading-tight text-white">{title}</p>
                          {isAdmin && (
                            <p className="text-[11px] text-white/60 break-all">
                              user_id: {it.user_id}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="border-white/40 text-white text-[10px]">
                          {(it.kind || "unknown").toString().toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-white/80 text-sm">{created}</TableCell>
                      <TableCell>
                        <Badge
                          variant={status === "failed" ? "destructive" : status === "pending" ? "secondary" : "outline"}
                          className="text-[10px]"
                        >
                          {status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
