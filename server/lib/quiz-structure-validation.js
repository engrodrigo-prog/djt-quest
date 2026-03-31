const normalizeCompareText = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export async function validateQuizStructure(admin, challengeId) {
  const errors = [];
  const warnings = [];

  const { data: questions, error: questionError } = await admin
    .from('quiz_questions')
    .select('id, question_text, difficulty_level, xp_value, order_index')
    .eq('challenge_id', challengeId)
    .order('order_index', { ascending: true });

  if (questionError) {
    return { ok: false, errors: [questionError.message], warnings, totalQuestions: 0 };
  }

  const questionList = Array.isArray(questions) ? questions : [];
  if (!questionList.length) {
    return { ok: false, errors: ['Adicione ao menos 1 pergunta antes de continuar'], warnings, totalQuestions: 0 };
  }

  const questionIds = questionList.map((q) => q.id);
  const { data: options, error: optionError } = await admin
    .from('quiz_options')
    .select('id, question_id, option_text, is_correct, explanation')
    .in('question_id', questionIds);

  if (optionError) {
    return { ok: false, errors: [optionError.message], warnings, totalQuestions: questionList.length };
  }

  const optionsByQuestion = new Map();
  for (const option of Array.isArray(options) ? options : []) {
    const key = String(option.question_id || '');
    if (!optionsByQuestion.has(key)) optionsByQuestion.set(key, []);
    optionsByQuestion.get(key).push(option);
  }

  const seenQuestions = new Map();

  questionList.forEach((question, idx) => {
    const label = `Q${idx + 1}`;
    const questionText = String(question?.question_text || '').trim();
    const normalizedQuestion = normalizeCompareText(questionText);
    const optionRows = Array.isArray(optionsByQuestion.get(String(question.id))) ? optionsByQuestion.get(String(question.id)) : [];

    if (questionText.length < 10) errors.push(`${label}: pergunta curta ou vazia.`);

    if (normalizedQuestion) {
      if (seenQuestions.has(normalizedQuestion)) {
        errors.push(`${label}: pergunta duplicada com Q${seenQuestions.get(normalizedQuestion)}.`);
      } else {
        seenQuestions.set(normalizedQuestion, idx + 1);
      }
    }

    if (optionRows.length !== 4) {
      errors.push(`${label}: precisa ter 4 alternativas salvas.`);
      return;
    }

    const correctCount = optionRows.filter((option) => Boolean(option?.is_correct)).length;
    if (correctCount !== 1) {
      errors.push(`${label}: precisa ter exatamente 1 alternativa correta.`);
    }

    const seenOptions = new Set();
    optionRows.forEach((option) => {
      const optionText = String(option?.option_text || '').trim();
      const normalizedOption = normalizeCompareText(optionText);
      if (optionText.length < 2) errors.push(`${label}: existe alternativa vazia.`);
      if (!normalizedOption) return;
      if (seenOptions.has(normalizedOption)) errors.push(`${label}: existem alternativas duplicadas.`);
      else seenOptions.add(normalizedOption);
    });

    const correct = optionRows.find((option) => Boolean(option?.is_correct));
    if (correct && !String(correct?.explanation || '').trim()) {
      warnings.push(`${label}: a correta está sem explicação.`);
    }
  });

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    totalQuestions: questionList.length,
  };
}
