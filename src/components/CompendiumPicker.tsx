import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { apiFetch } from '@/lib/api';

type CompendiumItem = {
  id: string;
  updated_at?: string | null;
  source_path?: string | null;
  final?: any | null;
  catalog?: any | null;
};

const normalize = (s: any) => String(s || '').toLowerCase();

export function CompendiumPicker({
  open,
  onOpenChange,
  onPick,
  title = 'Buscar no Compêndio',
  description = 'Selecione uma ocorrência catalogada para usar como base',
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (item: CompendiumItem) => void;
  title?: string;
  description?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<CompendiumItem[]>([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!open) return;
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const resp = await apiFetch('/api/admin?handler=compendium-list', { cache: 'no-store' });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(json?.error || 'Falha ao carregar compêndio');
        if (active) setItems(Array.isArray(json?.items) ? json.items : []);
      } catch {
        if (active) setItems([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [open]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return items;
    return items.filter((it) => {
      const cat = it.final?.catalog || it.final || it.catalog || {};
      const hay = [
        cat.title,
        cat.summary,
        cat.asset_area,
        cat.asset_type,
        cat.asset_subtype,
        cat.failure_mode,
        cat.root_cause,
        ...(Array.isArray(cat.keywords) ? cat.keywords : []),
      ]
        .map(normalize)
        .join(' ');
      return hay.includes(query);
    });
  }, [items, q]);

  const renderRow = (it: CompendiumItem) => {
    const cat = it.final?.catalog || it.final || it.catalog || {};
    const title = String(cat.title || 'Ocorrência');
    const area = String(cat.asset_area || '—');
    const type = String(cat.asset_type || '—');
    const mode = String(cat.failure_mode || '—');
    const root = String(cat.root_cause || '—');
    const tags = Array.isArray(cat.keywords) ? cat.keywords.slice(0, 5) : [];
    return (
      <div key={it.id} className="border rounded-lg p-3 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold truncate">{title}</div>
            <div className="text-xs text-muted-foreground truncate">
              {area} • {type} • {mode}
            </div>
            <div className="text-xs text-muted-foreground truncate">Causa raiz: {root}</div>
          </div>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => {
              onPick(it);
              onOpenChange(false);
            }}
          >
            Usar
          </Button>
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map((t: string) => (
              <Badge key={`${it.id}-${t}`} variant="secondary" className="text-[10px]">
                {t}
              </Badge>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por ativo, falha, causa raiz, palavra-chave..." />
          {loading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum item encontrado.</p>
          ) : (
            <div className="space-y-2 max-h-[55vh] overflow-auto pr-1">
              {filtered.map(renderRow)}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

