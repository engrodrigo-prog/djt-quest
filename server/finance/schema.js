import { z } from 'zod';
import {
  FINANCE_COMPANIES,
  FINANCE_COORDINATIONS,
  FINANCE_EXPENSE_TYPES,
  FINANCE_REQUEST_KINDS,
  FINANCE_STATUSES,
} from './constants.js';
import { parseBrlToCents } from './utils.js';

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use AAAA-MM-DD)');

const attachmentItem = z.object({
  url: z.string().url(),
  filename: z.string().trim().min(1).max(240).optional().nullable(),
  contentType: z.string().trim().min(1).max(120).optional().nullable(),
  sizeBytes: z.number().int().nonnegative().optional().nullable(),
  storageBucket: z.string().trim().min(1).max(80).optional().nullable(),
  storagePath: z.string().trim().min(1).max(600).optional().nullable(),
  metadata: z.record(z.any()).optional().nullable(),
});

const requestItem = z.object({
  expenseType: z.enum(FINANCE_EXPENSE_TYPES).optional().nullable(),
  description: z.string().trim().min(1).max(2000).optional().nullable(),
  amountBrl: z
    .string()
    .trim()
    .optional()
    .nullable()
    .refine((v) => v == null || v === '' || parseBrlToCents(v) != null, 'Valor inválido'),
  attachments: z.array(attachmentItem).optional().nullable(),
});

export const financeRequestCreateSchema = z
  .object({
    company: z.enum(FINANCE_COMPANIES),
    trainingOperational: z.enum(['Sim', 'Não']).transform((v) => v === 'Sim'),
    requestKind: z.enum(FINANCE_REQUEST_KINDS),
    expenseType: z.enum(FINANCE_EXPENSE_TYPES).optional().nullable(),
    coordination: z.enum(FINANCE_COORDINATIONS),
    dateStart: isoDate,
    dateEnd: isoDate.optional().nullable(),
    description: z.string().trim().min(10).max(5000),
    amountBrl: z
      .string()
      .trim()
      .optional()
      .nullable()
      .refine((v) => v == null || v === '' || parseBrlToCents(v) != null, 'Valor inválido'),
    attachments: z.array(attachmentItem).optional().nullable(),
    items: z.array(requestItem).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    const kind = data.requestKind;
    const end = data.dateEnd ? new Date(data.dateEnd) : null;
    const start = new Date(data.dateStart);
    if (data.dateEnd && Number.isFinite(start.getTime()) && end && end < start) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dateEnd'], message: 'Data Fim deve ser >= Data Início' });
    }

    const items = Array.isArray(data.items) ? data.items : [];
    const usingItems = items.length > 0;

    if (usingItems) {
      if (kind === 'Adiantamento') {
        for (let i = 0; i < items.length; i += 1) {
          const it = items[i] || {};
          const desc = String(it?.description || '').trim();
          if (!desc) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['items', i, 'description'],
              message: 'Descrição do item obrigatória',
            });
          }
          if (it?.expenseType && it.expenseType !== 'Adiantamento') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['items', i, 'expenseType'],
              message: 'Tipo deve ser Adiantamento',
            });
          }
          const a = Array.isArray(it?.attachments) ? it.attachments : [];
          if (a.length > 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['items', i, 'attachments'],
              message: 'Adiantamento não permite anexos',
            });
          }
        }
        return;
      }

      // Reembolso
      for (let i = 0; i < items.length; i += 1) {
        const it = items[i] || {};
        if (!it?.expenseType) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['items', i, 'expenseType'],
            message: 'Tipo do item obrigatório',
          });
        } else if (it.expenseType === 'Adiantamento') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['items', i, 'expenseType'],
            message: 'Tipo Adiantamento não permitido em Reembolso',
          });
        }
        const a = Array.isArray(it?.attachments) ? it.attachments : [];
        if (a.length < 1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['items', i, 'attachments'],
            message: 'Envie pelo menos 1 anexo por item',
          });
        }
        const amount = String(it?.amountBrl || '').trim();
        if (!amount) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['items', i, 'amountBrl'],
            message: 'Valor obrigatório por item',
          });
        }
      }

      return;
    }

    if (kind === 'Adiantamento') {
      if (data.expenseType && data.expenseType !== 'Adiantamento') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expenseType'], message: 'Tipo deve ser Adiantamento' });
      }
      return;
    }

    if (data.expenseType === 'Adiantamento') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expenseType'],
        message: 'Tipo Adiantamento não permitido em Reembolso',
      });
    }
    const a = Array.isArray(data.attachments) ? data.attachments : [];
    if (a.length < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['attachments'], message: 'Envie pelo menos 1 anexo' });
    }
    const amount = String(data.amountBrl || '').trim();
    if (!amount) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amountBrl'], message: 'Valor obrigatório' });
    }
  });

export const financeRequestCancelSchema = z.object({
  id: z.string().uuid(),
});

export const financeRequestAdminUpdateSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(FINANCE_STATUSES),
  observation: z.string().trim().max(2000).optional().nullable(),
});

export const financeRequestAdminDeleteSchema = z.object({
  id: z.string().uuid(),
  deleteStorage: z.boolean().optional().nullable().transform((v) => Boolean(v)),
});
