-- Compute final_points from average rating and team modifier
create or replace function public.update_event_points(_event_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
  _avg_rating numeric;
  _xp integer;
  _eval_multiplier numeric;
  _team_mod numeric;
begin
  select avg(rating) into _avg_rating from public.action_evaluations where event_id = _event_id;
  if _avg_rating is null then
    return;
  end if;
  select c.xp_reward, e.eval_multiplier, coalesce(t.team_modifier,1)
    into _xp, _eval_multiplier, _team_mod
  from public.events e
  left join public.challenges c on c.id = e.challenge_id
  left join public.profiles p on p.id = e.user_id
  left join public.teams t on t.id = p.team_id
  where e.id = _event_id;

  if _xp is null then _xp := 0; end if;
  if _eval_multiplier is null then _eval_multiplier := 1; end if;
  -- rating 1..5 -> 0..100% (divide by 5)
  update public.events
  set final_points = public.calculate_final_points(_xp, round((_avg_rating/5.0)::numeric, 2), _eval_multiplier, _team_mod)
  where id = _event_id;
end;
$$;

create or replace function public.trg_apply_points_fn()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.update_event_points(NEW.event_id);
  return NEW;
end;
$$;

drop trigger if exists trg_apply_points on public.action_evaluations;
create trigger trg_apply_points
after insert or update on public.action_evaluations
for each row execute function public.trg_apply_points_fn();
