import { z } from "@hono/zod-openapi";

export const TransactionResponseSchema = z.object({
    id: z.uuid(),
    amount: z.number(),
    type: z.enum(['income', 'expense', 'transfer']),
    date: z.string(),
    note: z.string().nullable(),
    isChecked: z.boolean(),
    accountId: z.number(),
    categoryId: z.number().nullable(),
    paymentMethodId: z.number().nullable(),
}).openapi('TransactionResponse');

export const CreateTransactionSchema = z.object({
    amount: z.number(),
    type: z.enum(['income', 'expense', 'transfer']),
    accountId: z.number(),
    categoryId: z.number().optional(),
    paymentMethodId: z.number().optional(),
    date: z.coerce.date().optional(),
    note: z.string().optional(),
    isChecked: z.boolean().optional().default(false)
}).openapi('CreateTransactionInput');

export const CreateTransferSchema = z.object({
    fromAccountId: z.uuid(),
    toAccountId: z.uuid(),
    amount: z.number().positive("Le montant doit être supérieur à 0"),
    categoryId: z.uuid().optional().nullable(),
    date: z.coerce.date().optional(),
    note: z.string().optional()
}).openapi('CreateTransferInput');