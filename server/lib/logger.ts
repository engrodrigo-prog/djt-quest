/**
 * logger.ts — Structured server-side logger.
 *
 * Outputs newline-delimited JSON in production (Vercel) so logs are
 * machine-parseable, and falls back to human-readable format in dev.
 *
 * Usage:
 *   import logger from './logger.js';
 *   logger.info('quiz draft generated', { userId, topic });
 *   logger.error('openai failed', { status: 429, model });
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
  [key: string]: unknown;
}

const isDev = process.env.NODE_ENV !== 'production' && !process.env.VERCEL;

function emit(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(ctx && Object.keys(ctx).length ? ctx : {}),
  };

  if (isDev) {
    const prefix = { debug: '⬜', info: '🟦', warn: '🟨', error: '🟥' }[level];
    const ctxStr = ctx && Object.keys(ctx).length ? ' ' + JSON.stringify(ctx) : '';
    // eslint-disable-next-line no-console
    console[level === 'debug' ? 'log' : level](`${prefix} [${level.toUpperCase()}] ${msg}${ctxStr}`);
  } else {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(entry));
  }
}

const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => emit('debug', msg, ctx),
  info:  (msg: string, ctx?: Record<string, unknown>) => emit('info',  msg, ctx),
  warn:  (msg: string, ctx?: Record<string, unknown>) => emit('warn',  msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => emit('error', msg, ctx),
};

export default logger;
