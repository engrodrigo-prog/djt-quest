import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getActiveLocale } from '@/lib/i18n/activeLocale';

type SepbookPostRow = {
  id: string;
  content_md: string;
  created_at: string;
  like_count: number | null;
  comment_count: number | null;
  attachments: any;
  repost_of: string | null;
};

const snippet = (s: string, max = 140) => {
  const t = String(s || '').trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
};

export function SepbookPostsCard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [posts, setPosts] = useState<SepbookPostRow[]>([]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('sepbook_posts')
          .select('id, content_md, created_at, like_count, comment_count, attachments, repost_of')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(12);
        if (error) throw error;
        if (active) setPosts((data || []) as any);
      } catch {
        if (active) setPosts([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [user]);

  return (
    <Card id="sepbook-history">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>SEPBook</CardTitle>
          <CardDescription>Suas publicações recentes</CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => navigate('/sepbook')}>
          Abrir
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {!loading && posts.length === 0 && <p className="text-sm text-muted-foreground">Você ainda não publicou no SEPBook.</p>}
        {posts.map((p) => (
          <button
            key={p.id}
            type="button"
            className="rounded-md border p-3 text-left hover:bg-accent/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => navigate(`/sepbook#post-${encodeURIComponent(p.id)}`)}
            aria-label="Abrir publicação no SEPBook"
            title="Abrir no SEPBook"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">{new Date(p.created_at).toLocaleString(getActiveLocale())}</p>
              <div className="flex items-center gap-2">
                {p.repost_of && <Badge variant="secondary">Repost</Badge>}
                <Badge variant="outline">♥ {Number(p.like_count || 0)}</Badge>
                <Badge variant="outline">💬 {Number(p.comment_count || 0)}</Badge>
              </div>
            </div>
            <p className="text-sm mt-2">{snippet(p.content_md || '', 180) || (p.repost_of ? 'Repost sem comentário.' : '—')}</p>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}
