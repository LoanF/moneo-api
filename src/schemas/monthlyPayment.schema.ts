import { z } from "@hono/zod-openapi";

export const MonthlyPaymentResponseSchema = z.object({
    id: z.number(),
    userId: z.number(),
    categoryId: z.number(),
    name: z.string(),
    amount: z.number(),
    dayOfMonth: z.number().min(1).max(31),
    type: z.enum(['credit', 'debit']),
    lastAppliedMonth: z.date().nullable(),
}).openapi('MonthlyPaymentResponse');

export const CreateMonthlyPaymentSchema = z.object({
    name: z.string().min(1),
    amount: z.number(),
    categoryId: z.number(),
    dayOfMonth: z.number().min(1).max(31),
    type: z.enum(['credit', 'debit']),
}).openapi('CreateMonthlyPaymentInput');