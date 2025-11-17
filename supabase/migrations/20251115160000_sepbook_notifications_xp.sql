-- SEPBook: menções, último acesso e funções auxiliares de XP

create table if not exists public.sepbook_mentions (
  post_id uuid not null references public.sepbook_posts(id) on delete cascade,
  mentioned_user_id uuid not null references auth.users(id) on delete cascade,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (post_id, mentioned_user_id)
);

create index if not exists idx_sepbook_mentions_user on public.sepbook_mentions(mentioned_user_id, is_read);

create table if not exists public.sepbook_last_seen (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

-- Incrementar contagem de comentários de forma segura
create or replace function public.increment_sepbook_comment_count(p_post_id uuid)
returns void
language plpgsql
as $$
begin
  update public.sepbook_posts
     set comment_count = coalesce(comment_count, 0) + 1,
         updated_at = now()
   where id = p_post_id;
end;
$$;

-- Incrementar XP diretamente no perfil (usado para engajamento do SEPBook)
create or replace function public.increment_profile_xp(p_user_id uuid, p_amount integer)
returns void
language plpgsql
as $$
begin
  update public.profiles
     set xp = coalesce(xp, 0) + greatest(coalesce(p_amount, 0), 0)
   where id = p_user_id;
end;
$$;

