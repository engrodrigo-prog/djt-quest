import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Check, ChevronsUpDown, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import djtCover from '@/assets/backgrounds/djt-quest-cover.webp';
import { apiFetch } from "@/lib/api";
import { buildAbsoluteAppUrl, openWhatsAppShare } from "@/lib/whatsappShare";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SUPPORTED_LOCALES, useI18n } from "@/contexts/I18nContext";
import { localeToOpenAiLanguageTag } from "@/lib/i18n/language";

interface UserOption {
  id: string;
  name: string;
  email: string;
  matricula?: string;
}

const LAST_USER_KEY = 'djt_last_user_id';
const MATRICULA_LOOKUP_MIN_LENGTH = 6;
const DEFAULT_PASSWORD = '123456';

const normalizeMatricula = (value?: string | null) =>
  (value ?? '').replace(/\D/g, '');

const Auth = () => {
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedUserName, setSelectedUserName] = useState("");
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<UserOption[]>([]);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [resetIdentifier, setResetIdentifier] = useState("");
  const [resetReason, setResetReason] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const matriculaLookupRef = useRef<string | null>(null);
  const suggestionsLookupRef = useRef<string | null>(null);
  const { signIn, refreshUserSession } = useAuth();
  const { locale, setLocale, t } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectParam = searchParams.get('redirect');

  const lookupProfiles = useCallback(async (params: { mode: string; query: string; limit?: number }) => {
    const resp = await apiFetch('/api/profile-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(json?.error || 'Falha ao buscar perfis');
    }
    return Array.isArray(json?.users) ? (json.users as UserOption[]) : [];
  }, []);

  const resolveRedirect = useCallback(() => {
    const raw = (redirectParam || '').trim();
    if (!raw) return null;
    if (!raw.startsWith('/')) return null;
    if (raw.startsWith('//')) return null;
    return raw;
  }, [redirectParam]);

  const normalizedQuery = query.trim().toLowerCase();
  const digitsQuery = normalizeMatricula(query);
  const nameTokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const isEmailMode = normalizedQuery.includes('@');
  const isMatriculaMode = !!digitsQuery && /^[0-9]+$/.test(digitsQuery);
  const allowSuggestions =
    (isMatriculaMode && digitsQuery.length >= MATRICULA_LOOKUP_MIN_LENGTH) ||
    (isEmailMode && normalizedQuery.length >= 3) ||
    (!isMatriculaMode && nameTokens.length >= 2 && nameTokens[1].length >= 1);

  const matchesSearch = (u: UserOption, needle: string) => {
    if (!needle) return true;
    const digitsNeedle = normalizeMatricula(needle);
    const matricula = normalizeMatricula(u.matricula);
    const name = (u.name ?? '').toLowerCase();
    const email = (u.email ?? '').toLowerCase();
    return (
      (digitsNeedle && matricula.includes(digitsNeedle)) ||
      name.includes(needle) ||
      email.includes(needle)
    );
  };

  const filteredUsers = allowSuggestions
    ? users.filter(u => matchesSearch(u, normalizedQuery))
    : [];

  const attemptLogin = useCallback(async (user: UserOption) => {
    setLoading(true);
    try {
      const email = String(user?.email || "").trim();
      if (!email) {
        toast.error(t("auth.errors.loginFailedTitle"), {
          description: "Usuário sem e-mail cadastrado. Contate o suporte/gestor.",
        });
        return;
      }

      const { error } = await signIn(email, password);

      if (error) {
        console.error("Login error:", error);
        toast.error(t("auth.errors.loginFailedTitle"), {
          description: error.message ?? t("auth.errors.loginFailedDesc"),
        });
        return;
      }

      const authData = await refreshUserSession();
      try {
        localStorage.setItem(LAST_USER_KEY, user.id);
      } catch {
        // ignore (Safari private mode / storage disabled)
      }
      if (password === DEFAULT_PASSWORD) {
        const profileId = authData?.profile?.id;
        if (profileId) {
          await supabase
            .from("profiles")
            .update({ must_change_password: true, needs_profile_completion: true })
            .eq("id", profileId);
          await refreshUserSession();
        }
      }

      const next = resolveRedirect();
      if (next) {
        navigate(next);
      } else {
        // Início deve ser o mesmo para todos; painel de liderança fica acessível a partir do Dashboard.
        navigate('/dashboard');
      }
    } catch (error) {
      console.error("Login error:", error);
      toast.error(t("auth.errors.loginUnexpectedTitle"), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [navigate, password, refreshUserSession, signIn, resolveRedirect, t]);

  const selectUser = useCallback((user: UserOption) => {
    setSelectedUserId(user.id);
    setSelectedUserName(user.name);
    setQuery(user.matricula ?? user.name);
    setOpen(false);
    requestAnimationFrame(() => {
      passwordRef.current?.focus();
    });
  }, []);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setOpen(true);

    // Sempre que o usuário começar a digitar de novo, limpe seleção e senha
    if (selectedUserId) {
      setSelectedUserId("");
      setSelectedUserName("");
      setPassword("");
    }

    if (!value.trim()) {
      setUsers([]);
      setSelectedUserId("");
      setSelectedUserName("");
      setPassword("");
      suggestionsLookupRef.current = null;
    }

    const digitsOnly = normalizeMatricula(value);
    // Só dispara lookup remoto após 6 dígitos da matrícula
    if (digitsOnly.length >= MATRICULA_LOOKUP_MIN_LENGTH) {
      fetchUserByMatriculaDigits(digitsOnly);
    }
  };

  const fetchUserByMatriculaDigits = useCallback(async (digits: string) => {
    if (matriculaLookupRef.current === digits) return;
    matriculaLookupRef.current = digits;
    try {
      // Try exact match first to avoid selecting a wrong partial match.
      const exact = await lookupProfiles({ mode: 'matricula_exact', query: digits, limit: 1 });
      const option = exact[0] || (await lookupProfiles({ mode: 'matricula_partial', query: digits, limit: 1 }))[0];
      if (!option) return;

      setUsers((prev) => {
        if (prev.some((u) => u.id === option.id)) return prev;
        return [option, ...prev];
      });
      selectUser(option);
    } catch (error) {
      console.error('Lookup error:', error);
    } finally {
      if (matriculaLookupRef.current === digits) {
        matriculaLookupRef.current = null;
      }
    }
  }, [lookupProfiles, selectUser]);

  const resolveUserFromQuery = useCallback(async (): Promise<UserOption | null> => {
    const trimmed = query.trim();
    const digitsOnly = normalizeMatricula(trimmed);
    const lower = trimmed.toLowerCase();
    const words = lower.split(/\s+/).filter(Boolean);

    try {
      if (digitsOnly.length >= MATRICULA_LOOKUP_MIN_LENGTH) {
        const exact = await lookupProfiles({ mode: 'matricula_exact', query: digitsOnly, limit: 1 });
        if (exact[0]) return exact[0];
        const partial = await lookupProfiles({ mode: 'matricula_partial', query: digitsOnly, limit: 1 });
        if (partial[0]) return partial[0];
      }

      if (trimmed.includes('@')) {
        const email = await lookupProfiles({ mode: 'email', query: lower, limit: 1 });
        if (email[0]) return email[0];
      }

      if (words.length >= 2 && words[1].length >= 1) {
        const name = await lookupProfiles({ mode: 'name', query: lower, limit: 1 });
        if (name[0]) return name[0];
      }
    } catch (error) {
      console.error('Login lookup error:', error);
    }

    return null;
  }, [lookupProfiles, query]);

  const fetchSuggestions = useCallback(async (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;

    const lower = trimmed.toLowerCase();
    const digitsOnly = normalizeMatricula(trimmed);
    const isDigitsOnly = !!digitsOnly && /^[0-9]+$/.test(digitsOnly);
    const isEmail = lower.includes('@');
    const words = lower.split(/\s+/).filter(Boolean);
    const canSearch =
      (isDigitsOnly && digitsOnly.length >= MATRICULA_LOOKUP_MIN_LENGTH) ||
      (isEmail && lower.length >= 3) ||
      (!isDigitsOnly && !isEmail && words.length >= 2 && words[1].length >= 1);

    if (!canSearch) return;

    const key = isDigitsOnly ? `m:${digitsOnly}` : isEmail ? `e:${lower}` : `n:${lower}`;
    if (suggestionsLookupRef.current === key) return;
    suggestionsLookupRef.current = key;

    try {
      const mode = isDigitsOnly ? 'matricula_partial' : isEmail ? 'email' : 'name';
      const data = await lookupProfiles({ mode, query: isDigitsOnly ? digitsOnly : lower, limit: 10 });
      if (suggestionsLookupRef.current !== key) return; // stale response
      setUsers(data || []);
    } catch (error) {
      console.error('Suggestions lookup error:', error);
    }
  }, [lookupProfiles]);

  useEffect(() => {
    let lastUserId: string | null = null;
    try {
      lastUserId = localStorage.getItem(LAST_USER_KEY);
    } catch {
      lastUserId = null;
    }
    if (!lastUserId) return;

    let cancelled = false;
    (async () => {
      try {
        const data = await lookupProfiles({ mode: 'id', query: lastUserId, limit: 1 });
        if (cancelled || !data?.[0]) return;
        const option = data[0];
        setUsers((prev) => (prev.some((u) => u.id === option.id) ? prev : [option, ...prev]));
        selectUser(option);
      } catch (error) {
        if (!cancelled) console.error('Error loading last user:', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [lookupProfiles, selectUser]);

  useEffect(() => {
    if (!allowSuggestions) return;
    const t = setTimeout(() => {
      void fetchSuggestions(query);
    }, 250);
    return () => clearTimeout(t);
  }, [allowSuggestions, fetchSuggestions, query]);

  const handleForgotSubmit = async () => {
    if (!resetIdentifier.trim()) {
      toast.error(t("auth.forgot.needIdentifier"));
      return;
    }
    setResetLoading(true);
    try {
      const response = await apiFetch('/api/admin?handler=request-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: resetIdentifier, reason: resetReason }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || t("auth.forgot.requestFailed"));
      toast.success(t("auth.forgot.requestSent"));
      setResetIdentifier('');
      setResetReason('');
      setForgotOpen(false);
    } catch (error: any) {
      toast.error(error?.message || t("auth.forgot.requestFailed"));
    } finally {
      setResetLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    let selectedUser = selectedUserId
      ? users.find(u => u.id === selectedUserId)
      : null;

    if (!selectedUser) {
      const resolved = await resolveUserFromQuery();
      if (resolved) {
        setUsers((prev) => {
          if (prev.some((u) => u.id === resolved.id)) return prev;
          return [resolved, ...prev];
        });
        selectUser(resolved);
        selectedUser = resolved;
      }
    }

    if (!selectedUser) {
      toast.error(t("auth.userNotFound"));
      return;
    }

    await attemptLogin(selectedUser);
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 animate-fade-in relative"
      style={{
        backgroundImage: `url(${djtCover})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[10px]" />
      <Card className="w-full max-w-md bg-white/90 text-slate-900 border border-white/70 shadow-[0_24px_70px_rgba(0,0,0,0.55)] relative z-10 backdrop-blur-xl">
        <CardHeader className="space-y-2">
          <div className="flex items-center justify-end">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-slate-700">{t("common.language")}</span>
              <Select value={locale} onValueChange={(v) => setLocale(v as any)}>
                <SelectTrigger className="h-8 w-[170px] bg-white text-slate-900 border-slate-300">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_LOCALES.map((l) => (
                    <SelectItem key={l} value={l}>
                      {t(`locale.${l}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <CardTitle className="text-3xl font-semibold leading-tight tracking-tight text-slate-900">
            {t("auth.title")}
          </CardTitle>
          <CardDescription className="text-sm text-slate-700">
            {selectedUserName ? t("auth.subtitleWelcome", { name: selectedUserName }) : t("auth.subtitleSearch")}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-slate-900">
          <form onSubmit={handleLogin} className="space-y-4 text-slate-900">
            <div className="space-y-2">
              <Label htmlFor="user" className="text-slate-900">{t("auth.userLabel")}</Label>
              <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                  <div className="relative">
                    <Input
                      id="user"
                      name="user"
                      placeholder={t("auth.userPlaceholder")}
                      value={query}
                      autoComplete="off"
                      inputMode="numeric"
                      onChange={(e) => handleQueryChange(e.target.value)}
                      onFocus={() => setOpen(true)}
                      onKeyDown={async (e) => {
                        if (e.key === 'Escape') {
                          setOpen(false);
                        } else if (e.key === 'Enter') {
                          e.preventDefault();
                          const resolved = await resolveUserFromQuery();
                          const candidate = resolved || (filteredUsers.length === 1 ? filteredUsers[0] : null);
                          if (!candidate) {
                            toast.error(t("auth.errors.userNotFoundDetailed"));
                            return;
                          }
                          selectUser(candidate);
                          if (password.trim()) {
                            await attemptLogin(candidate);
                          }
                        }
                      }}
                      className="w-full pr-10 bg-white text-slate-900 placeholder:text-slate-500 border-slate-300 focus-visible:ring-primary"
                      aria-expanded={open}
                      aria-controls="user-combobox"
                    />
                    <ChevronsUpDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-50 pointer-events-none" />
                  </div>
                </PopoverTrigger>
                <PopoverContent 
                  className="w-[var(--radix-popover-trigger-width)] p-0 z-50 bg-popover border shadow-lg" 
                  align="start"
                  sideOffset={4}
                  onOpenAutoFocus={(e) => e.preventDefault()}
                  id="user-combobox"
                  role="listbox"
                >
                  <Command shouldFilter={false}>
                    <CommandList>
                      <CommandEmpty>
                        Nenhum usuário encontrado para “{query}”. Pesquise pelo nome, matrícula ou e-mail.
                      </CommandEmpty>
                      <CommandGroup heading={filteredUsers.length > 0 ? `${filteredUsers.length} encontrado(s)` : undefined}>
                        {filteredUsers.map((user) => (
                          <CommandItem
                            key={user.id}
                            value={user.id}
                            onMouseDown={(e) => {
                              e.preventDefault();
                            }}
                            onSelect={() => {
                              selectUser(user);
                            }}
                            className={cn(selectedUserId === user.id && "bg-accent")}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                selectedUserId === user.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            {user.matricula ? `${user.matricula} — ${user.name}` : user.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="password" className="text-slate-900">{t("auth.passwordLabel")}</Label>
              <input type="text" name="username" autoComplete="username" hidden readOnly />
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder={t("auth.passwordPlaceholder")}
                autoFocus={!!selectedUserName}
                autoComplete={selectedUserId ? "current-password" : "off"}
                ref={passwordRef}
                className="bg-white text-slate-900 placeholder:text-slate-500 border-slate-300 focus-visible:ring-primary"
              />
              <p className="text-xs text-slate-600">
                {t("auth.defaultPasswordLabel")} <code className="bg-slate-100 text-slate-900 px-1 rounded">123456</code>
              </p>
              <Button
                type="button"
                variant="link"
                className="px-0 text-primary hover:text-primary/80"
                onClick={() => setForgotOpen(true)}
              >
                {t("auth.forgotPassword")}
              </Button>
            </div>
            
            <Button
              type="submit"
              className="w-full bg-primary text-primary-foreground hover:opacity-90"
              disabled={loading || (!selectedUserId && !query.trim())}
            >
              {loading ? t("auth.entering") : t("auth.enter")}
            </Button>

            <Button
              type="button"
              variant="outline"
              className="w-full mt-1 text-sm bg-white text-slate-900 border-slate-300 hover:bg-slate-50"
              onClick={() => {
                openWhatsAppShare({
                  message: t("auth.shareWhatsappMessage"),
                  url: buildAbsoluteAppUrl("/auth"),
                });
              }}
            >
              {t("auth.shareWhatsapp")}
            </Button>

            <div className="text-center text-sm mt-4">
              <span className="text-slate-600">{t("auth.noAccount")} </span>
              <Link 
                to="/register" 
                className="text-primary hover:underline font-medium"
              >
                {t("auth.requestSignup")}
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>

      <Dialog open={forgotOpen} onOpenChange={(open) => {
        setForgotOpen(open);
        if (!open) {
          setResetIdentifier('');
          setResetReason('');
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("auth.forgot.title")}</DialogTitle>
            <DialogDescription>{t("auth.forgot.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="reset-identifier">{t("auth.forgot.identifierLabel")}</Label>
              <Input
                id="reset-identifier"
                placeholder={t("auth.forgot.identifierPlaceholder")}
                value={resetIdentifier}
                onChange={(e) => setResetIdentifier(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="reset-reason">{t("auth.forgot.reasonLabel")}</Label>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={async () => {
                    const text = resetReason.trim();
                    if (!text) return;
                    try {
                      const resp = await apiFetch("/api/ai?handler=cleanup-text", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ title: t("auth.forgot.aiReviewTitle"), description: text, language: localeToOpenAiLanguageTag(locale) }),
                      });
                      const json = await resp.json().catch(() => ({}));
                      const usedAI = json?.meta?.usedAI !== false;
                      if (!resp.ok || !json?.cleaned?.description) {
                        throw new Error(json?.error || t("auth.forgot.aiReviewAutoFail"));
                      }
                      if (!usedAI) {
                        toast.error(t("auth.forgot.aiReviewFailed"));
                        return;
                      }
                      const cleaned = String(json.cleaned.description || text).trim();
                      if (cleaned === text) {
                        toast.success("Nenhuma correção necessária");
                        return;
                      }
                      setResetReason(cleaned);
                      toast.success(t("auth.forgot.aiReviewSuccess"));
                    } catch (e: any) {
                      toast.error(e?.message || t("auth.forgot.aiReviewFailed"));
                    }
                  }}
                  title={t("auth.forgot.aiReviewTooltip")}
                >
                  <Wand2 className="h-4 w-4" />
                </Button>
              </div>
              <Textarea
                id="reset-reason"
                placeholder={t("auth.forgot.reasonPlaceholder")}
                value={resetReason}
                onChange={(e) => setResetReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setForgotOpen(false)}>{t("auth.forgot.cancel")}</Button>
            <Button onClick={handleForgotSubmit} disabled={resetLoading}>
              {resetLoading ? t("auth.forgot.submitting") : t("auth.forgot.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Auth;
