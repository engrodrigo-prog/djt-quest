/**
 * ai-provider.ts
 *
 * Unified AI provider with OpenAI-first, Claude-fallback strategy.
 *
 * Usage:
 *   import { chatCompletion } from './ai-provider.js';
 *   const { content, provider, model } = await chatCompletion({ system, messages, maxTokens });
 */

import Anthropic from '@anthropic-ai/sdk';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionParams {
  /** OpenAI messages array (system + user + optional history) */
  messages: ChatMessage[];
  /** Max output tokens */
  maxTokens?: number;
  /** Temperature 0–2 (not used on gpt-5 series; ignored on Claude) */
  temperature?: number;
  /** Override OpenAI model (falls back to env OPENAI_MODEL_FAST/OPENAI_MODEL_PREMIUM) */
  openaiModel?: string;
  /** Override Claude model (defaults to claude-sonnet-4-6) */
  claudeModel?: string;
  /** AbortSignal for timeout */
  signal?: AbortSignal;
}

export interface ChatCompletionResult {
  /** Raw text returned by the model */
  content: string;
  /** Which provider actually served this response */
  provider: 'openai' | 'claude';
  /** Exact model ID used */
  model: string;
}

const OPENAI_BASE = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MAX_TOKENS = 800;
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6';

function getOpenAIKey(): string {
  return (process.env.OPENAI_API_KEY as string) || '';
}

function getAnthropicKey(): string {
  return (process.env.ANTHROPIC_API_KEY as string) || '';
}

function resolveOpenAIModel(override?: string): string {
  return (
    override ||
    (process.env.OPENAI_MODEL_FAST as string) ||
    (process.env.OPENAI_MODEL_PREMIUM as string) ||
    'gpt-4o'
  );
}

function resolveClaudeModel(override?: string): string {
  return override || (process.env.CLAUDE_MODEL as string) || DEFAULT_CLAUDE_MODEL;
}

/** Try OpenAI chat completions. Returns null on any failure. */
async function tryOpenAI(
  params: ChatCompletionParams,
): Promise<{ content: string; model: string } | null> {
  const apiKey = getOpenAIKey();
  if (!apiKey) return null;

  const model = resolveOpenAIModel(params.openaiModel);
  const isGpt5 = model.startsWith('gpt-5');
  const maxTokens = params.maxTokens ?? DEFAULT_MAX_TOKENS;

  const body: Record<string, unknown> = {
    model,
    messages: params.messages.map(({ role, content }) => ({ role, content })),
    ...(isGpt5 ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
    ...(!isGpt5 && params.temperature !== undefined ? { temperature: params.temperature } : {}),
  };

  try {
    const resp = await fetch(OPENAI_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!resp.ok) return null;

    const data = (await resp.json().catch(() => null)) as any;
    const content: string = data?.choices?.[0]?.message?.content ?? '';
    if (!content) return null;

    return { content, model };
  } catch {
    return null;
  }
}

/** Try Claude via Anthropic SDK. Returns null on any failure. */
async function tryClaude(
  params: ChatCompletionParams,
): Promise<{ content: string; model: string } | null> {
  const apiKey = getAnthropicKey();
  if (!apiKey) return null;

  const model = resolveClaudeModel(params.claudeModel);
  const maxTokens = params.maxTokens ?? DEFAULT_MAX_TOKENS;

  // Split system from user/assistant messages (Claude uses separate system param)
  const systemMsgs = params.messages.filter((m) => m.role === 'system');
  const convMsgs = params.messages.filter((m) => m.role !== 'system');

  const system = systemMsgs.map((m) => m.content).join('\n\n') || undefined;

  // Claude requires alternating user/assistant turns and must start with user
  const claudeMessages: { role: 'user' | 'assistant'; content: string }[] = convMsgs
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  if (claudeMessages.length === 0 || claudeMessages[0].role !== 'user') return null;

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages: claudeMessages,
    });

    const block = response.content?.[0];
    const content = block?.type === 'text' ? block.text : '';
    if (!content) return null;

    return { content, model };
  } catch {
    return null;
  }
}

/**
 * Send a chat completion request, trying OpenAI first and falling back to Claude.
 * Throws if both providers fail.
 */
export async function chatCompletion(
  params: ChatCompletionParams,
): Promise<ChatCompletionResult> {
  const openaiResult = await tryOpenAI(params);
  if (openaiResult) {
    return { content: openaiResult.content, provider: 'openai', model: openaiResult.model };
  }

  const claudeResult = await tryClaude(params);
  if (claudeResult) {
    return { content: claudeResult.content, provider: 'claude', model: claudeResult.model };
  }

  throw new Error('All AI providers failed. Check OPENAI_API_KEY and ANTHROPIC_API_KEY.');
}

/**
 * Convenience wrapper for the common JSON-generation pattern:
 * calls chatCompletion and returns the raw content string.
 * Caller is responsible for parsing JSON from the content.
 */
export async function chatCompletionText(
  params: ChatCompletionParams,
): Promise<string> {
  const result = await chatCompletion(params);
  return result.content;
}
