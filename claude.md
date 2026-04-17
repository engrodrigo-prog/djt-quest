# DJT Quest — Instruções do Projeto

## Objetivo
Este projeto é uma aplicação web para uso operacional/corporativo, com front-end em React + Vite e backend composto por Supabase e rotas serverless em `api/*.ts`.

As mudanças devem priorizar:
- segurança de alteração;
- clareza de código;
- compatibilidade com a arquitetura existente;
- baixo risco de regressão;
- manutenção simples.

## Stack principal
- Node.js 22.x
- Vite
- React
- TypeScript
- Tailwind CSS
- shadcn/ui + Radix UI
- Supabase JS
- TanStack React Query
- Leaflet / React-Leaflet
- Vercel para rotas serverless e deploy

## Estrutura do projeto
- `src/`: front-end principal
- `shared/`: tipos, utilitários ou contratos compartilhados
- `api/`: endpoints serverless da Vercel
- `server/`: lógica server-side adicional, quando aplicável
- `supabase/migrations/`: migrações SQL
- `supabase/functions/`: Edge Functions
- `docs/`: documentação técnica e operacional
- `scripts/`: scripts utilitários, seeds e manutenção
- `test/`: testes
- `public/`: assets estáticos
- `locales/`: internacionalização, quando aplicável

## Comandos principais
- instalar dependências: `npm i`
- rodar localmente: `npm run dev`
- build de produção: `npm run build`
- preview local: `npm run preview`
- testes: `npm test`

## Regras gerais para o Claude
- Antes de alterar código, entender onde a responsabilidade daquela lógica deveria estar: `src`, `api`, `server`, `shared` ou `supabase`.
- Preferir mudanças pequenas, localizadas e reversíveis.
- Não refatorar arquivos não relacionados só por estética.
- Não inventar endpoints, tabelas, colunas, buckets ou variáveis de ambiente sem evidência no projeto.
- Quando houver dúvida entre regra de negócio no front-end e no backend, preferir validação também no backend.
- Sempre considerar impacto em autenticação, autorização, storage e políticas do Supabase.
- Sempre considerar impacto em deploy Vercel.
- Sempre preservar compatibilidade com TypeScript estrito, quando existente.

## Padrões de implementação
- Preferir TypeScript explícito; evitar `any`.
- Manter componentes React pequenos e com responsabilidade clara.
- Separar UI, chamadas de dados e regras de transformação quando isso reduzir acoplamento.
- Reutilizar componentes existentes antes de criar novos.
- Reutilizar hooks/utilitários existentes antes de duplicar lógica.
- Validar entradas em APIs serverless.
- Tratar erros com mensagens claras, sem esconder falhas silenciosamente.
- Para operações assíncronas, expor estado de carregamento, sucesso e erro no front-end quando aplicável.
- Não misturar regra de acesso somente visual no cliente com segurança real; o backend deve continuar protegendo dados e ações.

## Supabase
- Considerar que há migrações em `supabase/migrations/` e funções em `supabase/functions/`.
- Ao propor alteração de banco, descrever:
  1. objetivo da mudança;
  2. impacto esperado;
  3. migração necessária;
  4. risco de compatibilidade;
  5. rollback ou mitigação.
- Não assumir permissões amplas com `service_role`.
- Toda operação sensível deve considerar políticas/RLS, autenticação e contexto do usuário.

## Vercel / API
- Endpoints em `api/*.ts` devem ser tratados como contratos estáveis.
- Mudanças em request/response devem explicitar impacto no front-end.
- Sempre validar método HTTP, parâmetros obrigatórios e erros de integração.
- Não retornar mensagens ambíguas em falhas server-side.
- Se uma rota depender de variáveis de ambiente, citar explicitamente quais são necessárias.

## Front-end
- Manter consistência visual com Tailwind e componentes existentes.
- Evitar criar padrões paralelos de UI sem necessidade.
- Em formulários:
  - validar campos obrigatórios;
  - tratar loading;
  - tratar erro;
  - evitar submissão dupla;
  - exibir feedback claro ao usuário.
- Em telas com dados remotos:
  - tratar loading, empty state e erro;
  - evitar refetch desnecessário;
  - considerar React Query quando já fizer parte do fluxo.

## Qualidade e testes
- Toda mudança deve vir com validação mínima.
- Quando alterar lógica:
  - indicar como testar manualmente;
  - adicionar ou ajustar testes, se houver cobertura aplicável;
  - listar cenários de regressão relevantes.
- Antes de concluir, verificar:
  - build;
  - tipagem;
  - imports quebrados;
  - contratos de API afetados;
  - impacto em variáveis de ambiente.

## Variáveis de ambiente
- Nunca hardcodar secrets.
- Usar apenas variáveis compatíveis com o contexto:
  - client-side: apenas variáveis próprias para exposição ao cliente;
  - server-side: chaves sensíveis somente no backend.
- Se uma funcionalidade nova depender de env, documentar em `.env.example` e/ou `docs/`.

## Restrições
- Não trocar stack sem justificativa forte.
- Não mover arquivos em massa sem necessidade.
- Não criar abstrações genéricas prematuras.
- Não simplificar segurança, autenticação ou autorização para “fazer funcionar”.
- Não introduzir dependências novas sem justificar ganho técnico real.

## Critérios de aceite
Uma entrega só é considerada pronta quando:
1. resolve o problema solicitado;
2. respeita a arquitetura existente;
3. não inventa estrutura inexistente;
4. declara hipóteses e limitações;
5. possui validação mínima;
6. minimiza risco de regressão.

## Forma esperada de resposta do Claude
Quando sugerir mudanças relevantes:
- explicar rapidamente o problema;
- dizer o que será alterado;
- apontar riscos;
- informar arquivos impactados;
- incluir passos objetivos de validação.

Quando gerar código:
- entregar pronto para uso;
- manter consistência com o padrão do projeto;
- evitar placeholders vagos;
- não omitir tratamento básico de erro.