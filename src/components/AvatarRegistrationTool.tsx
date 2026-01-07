import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AvatarDisplay } from "@/components/AvatarDisplay";
import { AvatarCapture } from "@/components/AvatarCapture";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Search, Camera } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchTeamNames } from "@/lib/teamLookup";
import { apiFetch } from "@/lib/api";

interface ProfileSummary {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  avatar_thumbnail_url: string | null;
  sigla_area: string | null;
  team_id?: string | null;
  team?: { name: string | null } | null;
}

export const AvatarRegistrationTool = () => {
  const [users, setUsers] = useState<ProfileSummary[]>([]);
  const [selectedUser, setSelectedUser] = useState<ProfileSummary | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarGenerating, setAvatarGenerating] = useState(false);
  const [avatarOptions, setAvatarOptions] = useState<string[]>([]);
  const [selectedAvatarOption, setSelectedAvatarOption] = useState<string | null>(null);
  const [avatarSourceImage, setAvatarSourceImage] = useState<string | null>(null);
  const [showMissingOnly, setShowMissingOnly] = useState(true);
  const { toast } = useToast();

  const loadUsers = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("profiles")
        .select("id, name, email, avatar_url, avatar_thumbnail_url, sigla_area, team_id")
        .order("avatar_url", { ascending: true })
        .order("name");

      if (error) throw error;

      const typedData = (data as ProfileSummary[]) || [];
      const teamMap = await fetchTeamNames(typedData.map((user) => user.team_id));
      const hydrated = typedData.map((user) => ({
        ...user,
        team: user.team_id ? { name: teamMap[user.team_id] || null } : null,
      }));
      setUsers(hydrated);

      if (selectedUser) {
        const refreshed = hydrated.find((user) => user.id === selectedUser.id);
        if (refreshed) {
          setSelectedUser(refreshed);
        }
      }
    } catch (error) {
      console.error("Error loading profiles without avatar:", error);
      toast({
        title: "Erro ao carregar colaboradores",
        description: "Tente novamente em instantes",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetAvatarFlow = () => {
    setAvatarOptions([]);
    setSelectedAvatarOption(null);
    setAvatarSourceImage(null);
    setAvatarGenerating(false);
    setAvatarSaving(false);
  };

  useEffect(() => {
    resetAvatarFlow();
  }, [selectedUser?.id]);

  const generateAvatarOptions = async (_imageBase64: string) => {
    // AI generation removed; no-op
    setAvatarOptions([]);
    setSelectedAvatarOption(null);
  };

  const handleAvatarCaptured = async (imageBase64: string) => {
    if (!selectedUser) {
      toast({ title: 'Selecione um colaborador primeiro', variant: 'destructive' });
      return;
    }
    setSelectedAvatarOption(imageBase64);
    await finalizeAvatarForUser(imageBase64);
  };

  const finalizeAvatarForUser = async (overrideBase64?: string) => {
    const base64ToUse = overrideBase64 || selectedAvatarOption || avatarSourceImage;
    if (!selectedUser || !base64ToUse) {
      toast({ title: 'Selecione uma opção de avatar', variant: 'destructive' });
      return;
    }
    try {
      setAvatarSaving(true);
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const resp = await apiFetch('/api/admin?handler=upload-avatar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          userId: selectedUser.id,
          imageBase64: base64ToUse,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || 'Falha ao salvar');

      setUsers((prev) =>
        prev.map((user) =>
          user.id === selectedUser.id
            ? { ...user, avatar_url: data?.avatarUrl ?? user.avatar_url, avatar_thumbnail_url: data?.avatarUrl ?? user.avatar_thumbnail_url }
            : user,
        ),
      );

      setSelectedUser((prev) =>
        prev ? { ...prev, avatar_url: data?.avatarUrl ?? prev.avatar_url, avatar_thumbnail_url: data?.avatarUrl ?? prev.avatar_thumbnail_url } : prev,
      );

      toast({
        title: 'Foto cadastrada',
        description: `${selectedUser.name} já aparece com foto atualizada`,
      });
      resetAvatarFlow();
    } catch (error) {
      console.error('Error updating avatar for user:', error);
      toast({
        title: 'Não foi possível salvar a foto',
        description: error instanceof Error ? error.message : 'Verifique a conexão e tente novamente',
        variant: 'destructive',
      });
    } finally {
      setAvatarSaving(false);
    }
  };

  const missingCount = useMemo(() => users.filter((user) => !user.avatar_url).length, [users]);

  const filteredUsers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return users
      .filter((user) => (showMissingOnly ? !user.avatar_url : true))
      .filter((user) => {
        if (!term) return true;
        return (
          user.name.toLowerCase().includes(term) ||
          user.email.toLowerCase().includes(term) ||
          (user.sigla_area ?? "").toLowerCase().includes(term) ||
          (user.team?.name ?? "").toLowerCase().includes(term)
        );
      });
  }, [users, showMissingOnly, searchTerm]);

  const coveragePercent = users.length > 0 ? Math.round(((users.length - missingCount) / users.length) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Cadastro de Fotos</h1>
        <p className="text-muted-foreground">
          Capture ou envie fotos oficiais para gerar os avatars personalizados do time.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[3fr,2fr]">
        <Card>
          <CardHeader className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>Colaboradores</CardTitle>
                <CardDescription>
                  {missingCount} sem foto · Cobertura {coveragePercent}%
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={loadUsers} disabled={loading}>
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                <span className="ml-2 hidden sm:inline">Atualizar lista</span>
              </Button>
            </div>
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <div className="relative w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nome, email ou equipe"
                  className="pl-9"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch id="missing-only" checked={showMissingOnly} onCheckedChange={setShowMissingOnly} />
                <Label htmlFor="missing-only" className="text-sm text-muted-foreground">
                  Apenas sem foto
                </Label>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Camera className="h-12 w-12 mx-auto mb-3" />
                <p>Nenhum colaborador encontrado com os filtros atuais.</p>
              </div>
            ) : (
              <ScrollArea className="h-[520px] pr-4">
                <div className="space-y-3">
                  {filteredUsers.map((user) => (
                    <button
                      key={user.id}
                      onClick={() => setSelectedUser(user)}
                      className={cn(
                        "w-full text-left rounded-xl border p-3 transition-all flex items-center gap-3",
                        selectedUser?.id === user.id
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/40"
                      )}
                    >
                    <AvatarDisplay
                      userId={user.id}
                      name={user.name}
                      avatarUrl={user.avatar_thumbnail_url || user.avatar_url}
                      size="sm"
                    />
                      <div className="flex-1">
                        <p className="font-semibold text-sm">{user.name}</p>
                        <p className="text-xs text-muted-foreground">{user.email}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {user.team?.name || user.sigla_area || "Sem time"}
                        </p>
                      </div>
                      <Badge
                        variant={user.avatar_url ? "secondary" : "destructive"}
                        className={cn("text-[11px]", user.avatar_url ? "text-foreground" : "text-destructive-foreground")}
                      >
                        {user.avatar_url ? "Com foto" : "Sem foto"}
                      </Badge>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Foto do perfil</CardTitle>
              <CardDescription>
                Selecione um colaborador para capturar a foto oficial.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {selectedUser ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <AvatarDisplay
                      userId={selectedUser.id}
                      name={selectedUser.name}
                      avatarUrl={selectedUser.avatar_url}
                      size="lg"
                    />
                    <div>
                      <p className="font-semibold text-lg">{selectedUser.name}</p>
                      <p className="text-sm text-muted-foreground">{selectedUser.email}</p>
                      <p className="text-xs text-muted-foreground">
                        {selectedUser.team?.name || selectedUser.sigla_area || "Sem equipe definida"}
                      </p>
                    </div>
                  </div>
                  {selectedUser.avatar_url ? (
                    <div className="rounded-lg border border-green-200 bg-green-50/70 px-3 py-2 text-sm text-green-900">
                      Já existe uma foto para este perfil. Capturar uma nova irá substituir a atual.
                    </div>
                  ) : (
                    <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm text-amber-900">
                      Este colaborador ainda não possui foto cadastrada.
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center text-muted-foreground py-12">
                  <Camera className="h-12 w-12 mx-auto mb-3" />
                  <p>Selecione alguém da lista para iniciar o cadastro.</p>
                </div>
              )}
            </CardContent>
          </Card>

          {selectedUser && (
            <Card>
              <CardHeader>
                <CardTitle>Captura / Upload</CardTitle>
                <CardDescription>Capture ou envie uma foto e confirme para atualizar o avatar.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <AvatarCapture
                  onCapture={handleAvatarCaptured}
                  onSkip={() => {
                    setSelectedUser(null);
                    resetAvatarFlow();
                  }}
                />
                {avatarGenerating && (
                  <p className="text-sm text-muted-foreground text-center">Processando imagem...</p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};
