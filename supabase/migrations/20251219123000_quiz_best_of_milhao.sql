-- Best-of scoring helper for Quiz do Milhão retries:
-- awards only the delta above the stored best (quiz_attempts.score) and never decreases XP.

create or replace function public.award_quiz_best_delta(
  _user_id uuid,
  _challenge_id uuid,
  _new_total integer
)
returns table (xp_awarded integer, best_score integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_best integer;
  new_best integer;
  delta integer;
begin
  if _user_id is null or _challenge_id is null then
    raise exception 'Missing params';
  end if;

  _new_total := coalesce(_new_total, 0);
  if _new_total < 0 then
    _new_total := 0;
  end if;

  -- Ensure attempt row exists
  insert into public.quiz_attempts (user_id, challenge_id, score)
  values (_user_id, _challenge_id, 0)
  on conflict (user_id, challenge_id) do nothing;

  -- Lock row and compute delta atomically
  select coalesce(score, 0)
    into current_best
  from public.quiz_attempts
  where user_id = _user_id
    and challenge_id = _challenge_id
  for update;

  new_best := greatest(coalesce(current_best, 0), _new_total);
  delta := new_best - coalesce(current_best, 0);

  if delta > 0 then
    perform public.increment_user_xp(_user_id, delta);
    update public.quiz_attempts
      set score = new_best
    where user_id = _user_id
      and challenge_id = _challenge_id;
  end if;

  xp_awarded := greatest(0, delta);
  best_score := new_best;
  return next;
end;
$$;

revoke all on function public.award_quiz_best_delta(uuid, uuid, integer) from public;
grant execute on function public.award_quiz_best_delta(uuid, uuid, integer) to service_role;

