# Performance after (DJT Quest)

Data (UTC): 2025-12-17T23:58:45Z

## Mudanças aplicadas (sem alterar regras de negócio)
- Troca de assets pesados `.png` por `.webp` nos backgrounds/ícones principais.
  - Arquivos convertidos em `src/assets/backgrounds/*.webp`
  - Imports atualizados em páginas e componentes que usam esses assets.

## Comparação com o baseline
Baseline: `docs/performance-baseline.md`

### Tamanho total do build
- Antes:
  - `dist/`: ~27 MB
  - `dist/assets/`: ~24 MB
- Depois:
  - `dist/`: ~5.3 MB
  - `dist/assets/`: ~2.2 MB

Impacto esperado:
- Menos bytes baixados em navegação inicial (especialmente páginas com background full-screen).
- Melhor LCP em redes móveis/lentas (depende do device).

### JS (somando chunks)
- Antes:
  - Total JS: ~1,342.4 KB
  - Total JS gzip: ~414.6 KB
  - Chunks JS: 82
- Depois:
  - Total JS: ~1,337.3 KB
  - Total JS gzip: ~413.3 KB
  - Chunks JS: 82

Observação:
- Mudança focou em imagens, então JS permanece praticamente estável (sem regressão perceptível).

### CSS
- `index-*.css`: ~106 KB (inalterado)

### Assets grandes
- Antes: PNGs entre ~1.3 MB e ~3.1 MB (vários).
- Depois: WebP equivalentes entre ~6 KB e ~198 KB.

## Validação sugerida (para comprovar “sem regressão”)
Rodar Lighthouse (desktop + mobile) e comparar com o baseline:
```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
npx lighthouse http://127.0.0.1:4173 --preset=desktop --output=json --output-path=./lighthouse-desktop.after.json
npx lighthouse http://127.0.0.1:4173 --preset=mobile --output=json --output-path=./lighthouse-mobile.after.json
```

Critério (conforme pedido):
- não aceitar piora >5% nas métricas (LCP/INP/CLS e/ou bundle inicial) ao avançar para as próximas mudanças.

