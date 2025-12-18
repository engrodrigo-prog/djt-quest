# SFX (game feel) — DJT Quest

## Objetivo
Adicionar sons curtos (SFX) para melhorar o “game feel”, sem quebrar regras de negócio.

## Flag
- `NEXT_PUBLIC_SFX_ENABLED`
  - Default: ligado (quando ausente)
  - Desligar: `0` / `false` / `off` / `no`

## Assets
- `public/sfx/*.ogg` (preferido quando suportado)
- `public/sfx/*.mp3` (fallback)

Eventos → arquivos:
- `click` → `public/sfx/click.(ogg|mp3)`
- `select` → `public/sfx/select.(ogg|mp3)`
- `correct` → `public/sfx/correct.(ogg|mp3)`
- `wrong` → `public/sfx/wrong.(ogg|mp3)`
- `complete` → `public/sfx/complete.(ogg|mp3)`
- `notification` → `public/sfx/notification.(ogg|mp3)`

## Persistência
- Local: `localStorage`
  - `djt_sfx_muted` (`0|1`)
  - `djt_sfx_volume` (`0..1`)
- Backend (Supabase): `profiles`
  - `sfx_muted boolean`
  - `sfx_volume real` (0..1)

## Como usar no frontend
- Provider/hook:
  - `src/lib/sfx/provider.tsx`
  - `useSfx().play("click" | "select" | ...)`
- O Provider:
  - não toca som antes da 1ª interação do usuário (autoplay policy)
  - aplica pool simples por evento (evita criar `Audio` a cada play)
  - aplica ducking quando houver TTS (via eventos `window` `tts:start`/`tts:end`)

