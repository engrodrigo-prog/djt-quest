export interface GameTip {
  title: string;
  body: string;
}

// Dicas centralizadas sobre jogabilidade, XP e uso de cada ferramenta.
// Atualize aqui sempre que a lógica de XP ou funcionalidades mudarem.
export const gameTips: Record<string, GameTip> = {
  'studio-content': {
    title: 'Campanhas • Quizzes • Fóruns',
    body: [
      'Aqui você cria e orquestra os conteúdos que geram XP e aprendizado formal.',
      '',
      '• Campanhas: organizam temas (ex.: segurança, NR10, cultura) em períodos com início/fim. Elas conectam quizzes, fóruns e registros no SEPBook sob uma mesma narrativa.',
      '• Quizzes: avaliam conhecimento de forma direta. Cada pergunta tem um valor de XP definido no Studio; ao responder corretamente, o jogador soma esse XP ao concluir o quiz.',
      '• Fóruns: são temas curados onde os relatos e soluções mais úteis podem gerar bônus de XP mensal, de 5% a 20% sobre o XP conquistado em quizzes e ações (quando o bônus estiver habilitado).',
      '',
      'Use este módulo para lançar novas campanhas, criar quizzes alinhados com as trilhas e abrir fóruns para consolidar aprendizados práticos.'
    ].join('\n'),
  },
  'studio-user-management': {
    title: 'Gerenciar Usuários',
    body: [
      'Ferramenta para cadastro, ajustes e limpeza de perfis.',
      '',
      '• Permite criar usuários, ajustar times, acesso ao Studio e trilhas.',
      '• Não concede XP diretamente, mas garante que o XP seja atribuído ao perfil correto (time, líder, base operacional).',
      '',
      'Sempre que novos times ou estruturas forem criados na organização, atualize aqui para manter a gamificação coerente com a realidade.'
    ].join('\n'),
  },
  'studio-performance': {
    title: 'Performance',
    body: [
      'Visão consolidada de engajamento e XP das equipes.',
      '',
      '• Mostra XP médio da equipe, XP total e ranking em relação a outras equipes.',
      '• Ajuda a identificar times que estão aproveitando melhor as campanhas, quizzes, fóruns e o SEPBook.',
      '',
      'Use esta tela para dar feedback em reuniões de time e ajustar metas de engajamento ao longo do ciclo.'
    ].join('\n'),
  },
  'studio-team-bonus': {
    title: 'Bonificação',
    body: [
      'Módulo para registrar eventos de reconhecimento e pontos de atenção.',
      '',
      '• Permite criar eventos de equipe que podem estar vinculados a campanhas ou metas internas.',
      '• Dependendo da configuração, esses eventos podem alimentar avaliações e métricas que influenciam XP ou bônus.',
      '',
      'Mantenha aqui o histórico de ações coletivas (campanhas internas, mutirões, inspeções) para que a trilha de XP reflita o esforço do time.'
    ].join('\n'),
  },
  'studio-user-approvals': {
    title: 'Cadastros & Aprovações',
    body: [
      'Central de filas para aprovar novos cadastros e mudanças de perfil.',
      '',
      '• Pendências aparecem como badge vermelho no ícone Studio e neste card.',
      '• Aprovar rapidamente garante que novos jogadores entrem na trilha com XP e permissões corretas.',
      '• Essas ações não geram XP direto, mas destravam o acesso às campanhas, quizzes, fóruns e SEPBook, onde o XP é conquistado.',
      '',
      'Use este módulo diariamente para manter a base de usuários atualizada e evitar bloqueios de acesso.'
    ].join('\n'),
  },
  'studio-password-resets': {
    title: 'Reset de Senha',
    body: [
      'Fila de solicitações de redefinição de senha.',
      '',
      '• Cada pedido precisa ser aprovado por um líder para manter a segurança.',
      '• Não gera XP, mas é crítico para que o jogador consiga participar das campanhas e quizzes em andamento.',
      '',
      'Ao aprovar um reset, oriente o jogador a atualizar a senha e revisar seu perfil antes de voltar a jogar.'
    ].join('\n'),
  },
  'studio-evaluations': {
    title: 'Avaliações',
    body: [
      'Aqui você avalia ações registradas pelos colaboradores (desafios/ações SEPBook vinculadas).',
      '',
      '• Cada avaliação considera critérios de qualidade (ex.: contexto, segurança, resultado, lições aprendidas).',
      '• Avaliações alimentam XP indireto ao valorizarem ações consistentes com as campanhas e fóruns, além de apoiar decisões de bônus.',
      '',
      'Use padrões claros de feedback positivos e construtivos. Isso aumenta a qualidade das próximas ações e dá significado ao XP conquistado.'
    ].join('\n'),
  },
  'studio-system': {
    title: 'Sistema',
    body: [
      'Painel técnico para verificar saúde do ambiente, integrações e dados.',
      '',
      '• Ajuda a identificar falhas de sincronização, problemas de cache e atrasos em cálculos de XP.',
      '• Não gera XP, mas mantém a gamificação funcionando sem ruídos (contagens de quizzes, fóruns, SEPBook, etc.).',
      '',
      'Use esta tela sempre que notar números estranhos de XP, rankings ou faltas de dados em campanhas.'
    ].join('\n'),
  },
  'studio-admin': {
    title: 'Admin (bônus global)',
    body: [
      'Ferramenta restrita a Gerentes DJT para aplicar bônus especiais.',
      '',
      '• Permite bonificar qualquer equipe ou usuário em situações excepcionais (campanhas corporativas, reconhecimentos amplos).',
      '• Deve ser usada com critério, para que o XP continue representando esforço real em quizzes, fóruns, SEPBook e ações avaliadas.',
      '',
      'Mantenha um registro claro das regras de concessão de bônus extra fora do fluxo normal de campanhas e fóruns.'
    ].join('\n'),
  },
  // Pontuação XP – visão rápida para jogadores (pode ser usada em tooltips ou onboarding)
  'xp-overview': {
    title: 'Como ganho XP no DJT Quest?',
    body: [
      'Algumas regras principais de pontuação:',
      '',
      '• SEPBook:',
      '  - +5 XP por publicação completa no SEPBook (post com texto e/ou mídia).',
      '  - +1 XP extra por comentário mais rico (≥30 caracteres, com # e @) em publicações.',
      '',
      '• Quizzes:',
      '  - Cada pergunta tem um valor de XP definido no Studio.',
      '  - Ao responder corretamente, você acumula esse XP; ao concluir o quiz, recebe um resumo do total conquistado.',
      '',
      '• Fóruns:',
      '  - Participar com relatos consistentes e soluções ajuda em bonus mensais.',
      '  - O módulo "Forum Bonus" pode conceder entre 5% e 20% de XP adicional sobre o XP do mês (quizzes + ações), para os perfis mais engajados.',
      '',
      '• Eventos & Avaliações:',
      '  - Ações registradas e avaliadas podem converter pontos em XP, conforme configurado pela área de gestão.',
      '',
      'Essas regras podem ser ajustadas ao longo do tempo. Sempre consulte seu líder ou o Studio para entender campanhas e bônus ativos no momento.'
    ].join('\n'),
  },
};

