-- Performance: add missing FK indexes reported by Supabase advisor.

create index if not exists idx_sepbook_comment_mentions_post_id
  on public.sepbook_comment_mentions (post_id);

create index if not exists idx_xp_awards_quiz_id
  on public.xp_awards (quiz_id);
