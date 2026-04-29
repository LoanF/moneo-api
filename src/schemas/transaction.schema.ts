import { z } from "@hono/zod-openapi";

export const TransactionResponseSchema = z.object({
    id: z.uuid(),
    amount: z.number(),
    type: z.enum(['income', 'expense', 'transfer']),
    date: z.string(),
    note: z.string().nullable(),
    isChecked: z.boolean(),
    accountId: z.uuid(),
    categoryId: z.uuid().nullable(),
    paymentMethodId: z.uuid().nullable(),
    chequeNumber: z.string().nullable(),
}).openapi('TransactionResponse');

export const CreateTransactionSchema = z.object({
    id: z.uuid(),
    amount: z.number(),
    type: z.enum(['income', 'expense', 'transfer']),
    accountId: z.uuid(),
    categoryId: z.uuid().optional(),
    paymentMethodId: z.uuid().optional(),
    chequeNumber: z.string().optional().nullable(),
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