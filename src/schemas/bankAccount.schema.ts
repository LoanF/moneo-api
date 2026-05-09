import { z } from "@hono/zod-openapi";

export const BankAccountResponseSchema = z.object({
    id: z.uuid(),
    userId: z.uuid(),
    name: z.string(),
    type: z.string(),
    balance: z.number(),
    pointedBalance: z.number(),
    sortOrder: z.number().int(),
    currency: z.string()
}).openapi('AccountResponse');

export const CreateBankAccountSchema = z.object({
    id: z.uuid(),
    name: z.string().min(1, "Nom du compte requis").max(30, "Le nom ne peut pas dépasser 30 caractères"),
    type: z.string().default('checking'),
    balance: z.number().default(0),
    currency: z.string().length(3).default('EUR')
}).openapi('CreateAccountInput');

export const UpdateBankAccountSchema = z.object({
    name: z.string().min(1).max(30, "Le nom ne peut pas dépasser 30 caractères").optional(),
    type: z.string().optional(),
    balance: z.number().optional(),
    currency: z.string().length(3).optional(),
    sortOrder: z.number().int().optional(),
}).openapi('UpdateBankAccountInput');