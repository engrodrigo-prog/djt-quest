-- Fix regex in count_image_attachments: avoid backslash escaping pitfalls under standard_conforming_strings.

create or replace function public.count_image_attachments(_attachments jsonb)
returns integer
language plpgsql
immutable
set search_path = public
as $$
declare
  out_count integer := 0;
  pattern text := '[.](png|jpe?g|webp|gif|bmp|tif|tiff|heic|heif|avif)([?#]|$)';
begin
  if _attachments is null then
    return 0;
  end if;
  if jsonb_typeof(_attachments) <> 'array' then
    return 0;
  end if;

  select coalesce(sum(
    case
      when jsonb_typeof(v) = 'string' then
        case
          when lower(trim(both '"' from v::text)) ~ pattern then 1
          else 0
        end
      when jsonb_typeof(v) = 'object' then
        case
          when lower(coalesce(v->>'url', v->>'publicUrl', v->>'href', v->>'src', '')) ~ pattern then 1
          else 0
        end
      else 0
    end
  ), 0)::int
  into out_count
  from jsonb_array_elements(_attachments) as v;

  return coalesce(out_count, 0);
end;
$$;

