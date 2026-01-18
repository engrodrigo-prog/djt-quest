# TTS (“Ler em voz”) — DJT Quest

## Objetivo
Permitir leitura em voz de textos (enunciados, explicações, análises do Monitor etc.) no idioma do usuário, com voz formal masculina ou feminina.

## Flag
- `NEXT_PUBLIC_TTS_ENABLED`
  - Default: ligado (quando ausente)
  - Desligar: `0` / `false` / `off` / `no`

## Backend
- Endpoint: `POST /api/tts`
- Modelo:
  - usa `OPENAI_TTS_MODEL` quando configurado
  - fallback: `gpt-4o-mini-tts` → `tts-1`
  - para testar `gpt-audio-2025-08-28` como leitura em voz, configure `OPENAI_TTS_MODEL="gpt-audio-2025-08-28"` (se o modelo suportar TTS na sua conta)
- Voz:
  - defaults: `male=alloy`, `female=nova`
  - override:
    - `OPENAI_TTS_VOICE_MALE`
    - `OPENAI_TTS_VOICE_FEMALE`
- Entrada:
  - `text` (string)
  - `locale` (`pt-BR` | `en` | `zh-CN`)
  - `voiceGender` (`male` | `female`)
  - `rate` (0.25..2)
- Saída:
  - `{ url }` (signed URL temporária do áudio em MP3)
- Cache:
  - por hash (texto + locale + voz + rate)
  - armazenado em bucket privado `tts-cache` (Supabase Storage)

## Frontend
- Provider/hook:
  - `src/lib/tts/provider.tsx`
  - `useTts().speak(text)` / `useTts().stop()`
  - long texts: o provider divide em blocos menores e toca em sequência (para evitar limite do backend)
- Persistência:
  - `localStorage` (`djt_tts_*`)
  - `profiles` (`tts_*`) quando o usuário está logado
- Regras:
  - só toca após gesto do usuário (autoplay policy)
  - dispara eventos `window` `tts:start` / `tts:end` para ducking em SFX
