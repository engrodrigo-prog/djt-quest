import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { getActiveLocale } from "@/lib/i18n/activeLocale";
import { normalizeTeamId } from "@/lib/constants/points";

type PersonRow = {
  id: string;
  name: string;
  team_id: string | null;
  is_leader?: boolean | null;
  studio_access?: boolean | null;
};

const GUEST_TEAM_ID = "CONVIDADOS";
const isGuestTeamId = (teamId: string | null | undefined) => normalizeTeamId(teamId) === GUEST_TEAM_ID;
const isLeaderProfile = (p: PersonRow) => Boolean(p?.is_leader) || Boolean(p?.studio_access);

export type ParticipantsSelectorValue = {
  selectedIds: string[];
};

export function ParticipantsSelector({
  currentUserId,
  currentTeamId,
  isGuest,
  value,
  onChange,
  className,
}: {
  currentUserId: string;
  currentTeamId: string | null | undefined;
  isGuest: boolean;
  value: ParticipantsSelectorValue;
  onChange: (next: ParticipantsSelectorValue) => void;
  className?: string;
}) {
  const [all, setAll] = useState<PersonRow[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("id,name,team_id,is_leader,studio_access")
          .order("name", { ascending: true })
          .limit(4000);
        if (error) throw error;
        if (!cancelled) setAll((Array.isArray(data) ? (data as any) : []) as PersonRow[]);
      } catch {
        if (!cancelled) setAll([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const normalizedTeam = normalizeTeamId(currentTeamId);
  const baseTeam = useMemo(() => (normalizedTeam.includes("-") ? normalizedTeam.split("-")[0] : normalizedTeam), [normalizedTeam]);

  const selectedSet = useMemo(() => new Set<string>(value?.selectedIds || []), [value?.selectedIds]);

  const visiblePeople = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all
      .filter((p) => Boolean(p?.id) && Boolean(p?.name))
      .filter((p) => {
        if (p.id === currentUserId) return true;
        if (isGuest) return false;
        return !isGuestTeamId(p.team_id);
      })
      .filter((p) => {
        if (!q) return true;
        return String(p.name || "").toLowerCase().includes(q);
      });
  }, [all, currentUserId, isGuest, search]);

  const grouped = useMemo(() => {
    const byId = new Map<string, PersonRow>();
    visiblePeople.forEach((p) => byId.set(String(p.id), p));
    const already = new Set<string>();

    const teamMembers: PersonRow[] = [];
    const leaders: PersonRow[] = [];
    const others: PersonRow[] = [];

    // 1) Members of my team (includes leaders if they are in the same team)
    for (const p of visiblePeople) {
      if (normalizeTeamId(p.team_id) && normalizeTeamId(p.team_id) === normalizedTeam) {
        teamMembers.push(p);
        already.add(p.id);
      }
    }

    // 2) Base leaders (e.g., DJTB leader sees DJTB-* team members first, then leader)
    if (!isGuest && baseTeam) {
      for (const p of visiblePeople) {
        if (already.has(p.id)) continue;
        if (!isLeaderProfile(p)) continue;
        if (normalizeTeamId(p.team_id) === baseTeam) {
          leaders.push(p);
          already.add(p.id);
        }
      }
    }

    // 3) Remaining users/leaders
    for (const p of visiblePeople) {
      if (already.has(p.id)) continue;
      others.push(p);
    }

    const sortByName = (a: PersonRow, b: PersonRow) =>
      String(a.name || "").localeCompare(String(b.name || ""), getActiveLocale());
    teamMembers.sort(sortByName);
    leaders.sort(sortByName);
    others.sort(sortByName);

    return { teamMembers, leaders, others, byId };
  }, [baseTeam, isGuest, normalizedTeam, visiblePeople]);

  const selectedPeople = useMemo(() => {
    const rows: PersonRow[] = [];
    for (const id of selectedSet) {
      const p = grouped.byId.get(String(id));
      if (p) rows.push(p);
    }
    const sortByName = (a: PersonRow, b: PersonRow) =>
      String(a.name || "").localeCompare(String(b.name || ""), getActiveLocale());
    rows.sort(sortByName);
    return rows;
  }, [grouped.byId, selectedSet]);

  const commitSelected = (next: Set<string>) => {
    // Always include the author (self) as a participant.
    next.add(currentUserId);
    onChange({ selectedIds: Array.from(next) });
  };

  const toggleOne = (id: string, checked: boolean) => {
    if (id === currentUserId) return;
    const next = new Set(selectedSet);
    if (checked) next.add(id);
    else next.delete(id);
    commitSelected(next);
  };

  if (isGuest) {
    return (
      <div className={className}>
        <p className="text-sm text-muted-foreground">
          Você está como <strong>Convidado</strong>: a evidência será registrada apenas com você.
        </p>
      </div>
    );
  }

  const renderGroup = (title: string, people: PersonRow[]) => {
    if (!people.length) return null;
    return (
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{title}</p>
        <div className="space-y-1">
          {people.map((p) => {
            const checked = selectedSet.has(p.id) || p.id === currentUserId;
            const disabled = p.id === currentUserId;
            return (
              <label
                key={p.id}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-white/5 cursor-pointer select-none"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={(e) => toggleOne(p.id, e.target.checked)}
                />
                <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                <Badge variant="outline" className="text-[10px]">
                  {isLeaderProfile(p) ? "Líder" : "Usuário"}
                </Badge>
              </label>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className={className}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Input
          placeholder="Buscar por nome…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-sm"
        />
        <div className="text-[11px] text-muted-foreground">
          {selectedPeople.length} selecionado(s)
        </div>
      </div>

      {selectedPeople.length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Selecionados</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {selectedPeople.map((p) => (
              <span
                key={`sel-${p.id}`}
                className="inline-flex items-center gap-2 rounded-full border bg-white/5 px-2 py-1 text-[12px]"
              >
                <span className="truncate max-w-[180px]">{p.name}</span>
                {p.id !== currentUserId && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => toggleOne(p.id, false)}
                    aria-label="Remover participante"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 max-h-80 overflow-auto rounded-md border bg-black/20 p-3 space-y-4">
        {renderGroup("Minha equipe", grouped.teamMembers)}
        {renderGroup("Líder", grouped.leaders)}
        {renderGroup("Demais", grouped.others)}
        {visiblePeople.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum usuário encontrado.</p>
        )}
      </div>
    </div>
  );
}

