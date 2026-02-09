import { z } from "@hono/zod-openapi";

export const MonthlyPaymentResponseSchema = z.object({
    id: z.uuid(),
    userId: z.uuid(),
    name: z.string(),
    amount: z.number(),
    accountId: z.uuid(),
    categoryId: z.uuid().nullable(),
    dayOfMonth: z.number(),
    type: z.enum(['income', 'expense']),
}).openapi('CreateMonthlyPaymentInput');

export const CreateMonthlyPaymentSchema = z.object({
    name: z.string().min(1),
    amount: z.number(),
    accountId: z.uuid(),
    categoryId: z.number().optional().nullable(),
    dayOfMonth: z.number().min(1).max(31),
    type: z.enum(['income', 'expense']),
}).openapi('CreateMonthlyPaymentInput');

export const UpdateMonthlyPaymentSchema = CreateMonthlyPaymentSchema.partial().openapi('UpdateMonthlyPaymentInput');