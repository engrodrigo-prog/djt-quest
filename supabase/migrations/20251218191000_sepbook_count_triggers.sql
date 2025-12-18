-- SEPBook: keep like_count/comment_count consistent via triggers (RLS-safe)

create or replace function public.sepbook_set_like_count(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_post_id is null then
    return;
  end if;
  update public.sepbook_posts
     set like_count = (
       select count(*)::int from public.sepbook_likes l where l.post_id = p_post_id
     ),
         updated_at = now()
   where id = p_post_id;
end;
$$;

create or replace function public.sepbook_set_comment_count(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_post_id is null then
    return;
  end if;
  update public.sepbook_posts
     set comment_count = (
       select count(*)::int from public.sepbook_comments c where c.post_id = p_post_id
     ),
         updated_at = now()
   where id = p_post_id;
end;
$$;

create or replace function public.trg_sepbook_likes_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sepbook_set_like_count(coalesce(new.post_id, old.post_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_sepbook_likes_count on public.sepbook_likes;
create trigger trg_sepbook_likes_count
after insert or delete on public.sepbook_likes
for each row execute function public.trg_sepbook_likes_count();

create or replace function public.trg_sepbook_comments_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sepbook_set_comment_count(coalesce(new.post_id, old.post_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_sepbook_comments_count on public.sepbook_comments;
create trigger trg_sepbook_comments_count
after insert or delete on public.sepbook_comments
for each row execute function public.trg_sepbook_comments_count();

