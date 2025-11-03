# Changelog

## Novas funcionalidades
- **Importação CSV com sobrescrita**: módulo “Importar Usuários” no Studio carrega `cadastro CPFL GO.csv`, atualiza/cria usuários, papéis e perfis automaticamente.
- **Avatar com câmera/upload**: botão “Atualizar foto” no Perfil abre captura com consentimento e envia para Supabase (`process-avatar`), refletindo imediatamente no app.
- **Dashboard do líder mais claro**: seletor de escopo (Equipe/Coordenação/Divisão) e métricas que evidenciam o XP agregado do guarda‑chuva do líder.
- **Estúdio para líderes habilitado**: cálculo unificado de `studioAccess` (gerentes/coordenadores têm acesso garantido) e barra inferior disponível também no desktop.
- **Login mais rápido**: autocomplete busca por matrícula, nome ou e‑mail (ex.: digitar `601555` encontra Rodrigo Henrique).
- **Favicon “GO”**: aplicamos o ícone GO em SVG com fallback `.ico` em todas as páginas do SPA.

## Melhorias operacionais
- Fluxo de perfil atualizado obriga refresh da sessão ao completar dados/senha.
- Home “GO” redireciona imediatamente com base na sessão carregada.
- Studio Dashboard ganhou cartão para importações e mantém módulos condicionais por papel.
- ESLint relaxado para lidar com `any` legados enquanto o refino gradual acontece.
