import { z } from "@hono/zod-openapi";

export const BankAccountResponseSchema = z.object({
    id: z.number(),
    userId: z.number(),
    name: z.string().min(1, "Le nom est requis"),
    type: z.string(),
    balance: z.number(),
    currency: z.string()
}).openapi('AccountResponse');

export const CreateBankAccountSchema = z.object({
    name: z.string().min(1, "Nom du compte requis"),
    type: z.string().default('checking'),
    balance: z.number().default(0),
    currency: z.string().length(3).default('EUR')
}).openapi('CreateAccountInput');

export const UpdateBankAccountSchema = CreateBankAccountSchema.partial().openapi('UpdateBankAccountInput');