# Debug de `[Violation]` (message handler / forced reflow)

Este guia ajuda a encontrar a origem real (código-fonte) de avisos do Chrome DevTools como:

- `[Violation] 'message' handler took ...ms`
- `[Violation] Forced reflow while executing JavaScript took ...ms`

## 1) Gerar sourcemaps (para mapear `index-*.js` → `src/*`)

Por padrão o build não gera `.map`. Para habilitar:

```bash
VITE_SOURCEMAP=true npm run build
```

Alternativa equivalente:

```bash
GENERATE_SOURCEMAP=true npm run build
```

Recomendação: habilitar em **staging** (ou builds internos), não necessariamente em produção pública.

## 2) Ativar instrumentação leve no browser

Foi adicionado um probe (desligado por padrão) que:

- mede handlers de `message` e loga quando passam de um limiar
- mede leituras caras de layout/estilo (ex.: `getBoundingClientRect`, `getComputedStyle`)
- observa `longtasks` (quando suportado pelo browser)

Para ativar:

- via query string: abrir a tela com `?perf=1`
- via localStorage (persistente): no console do browser:
  ```js
  localStorage.setItem("perfDebug", "1");
  location.reload();
  ```

Para desativar:
```js
localStorage.removeItem("perfDebug");
location.reload();
```

## 3) Capturar um profile no Chrome DevTools

1. Abrir DevTools → aba **Performance**
2. Clicar **Record**
3. Reproduzir o fluxo que dispara o aviso
4. Parar a gravação

O que procurar:

- eventos/handlers ligados a **MessageEvent**
- blocos **Recalculate Style** / **Layout** dentro de long tasks
- call stack mapeada (com sourcemap ativo) apontando para `src/...`

## 4) O que compartilhar internamente (pra corrigir rápido)

- URL/rota + passos exatos para reproduzir
- um print do console com os grupos `[perf] message handler` / `[perf] layout-read`
- o arquivo `.json` exportado do Performance trace (DevTools → Save profile)

