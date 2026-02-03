import { z } from "@hono/zod-openapi";

export const PaymentMethodResponseSchema = z.object({
    id: z.number(),
    name: z.string().min(1),
    type: z.enum(['credit', 'debit']),
    userId: z.number()
}).openapi('PaymentMethodResponse');

export const CreatePaymentMethodSchema = z.object({
    name: z.string().min(1, "Le nom est requis"),
    type: z.enum(['credit', 'debit']).default('debit')
}).openapi('CreatePaymentMethodInput');