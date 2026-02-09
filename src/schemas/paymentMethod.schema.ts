import { z } from "@hono/zod-openapi";

export const PaymentMethodResponseSchema = z.object({
    id: z.uuid(),
    name: z.string().min(1),
    type: z.enum(['credit', 'debit']),
    userId: z.uuid()
}).openapi('PaymentMethodResponse');

export const CreatePaymentMethodSchema = z.object({
    id: z.uuid(),
    name: z.string().min(1, "Le nom est requis"),
    type: z.enum(['credit', 'debit']).default('debit')
}).openapi('CreatePaymentMethodInput');

export const UpdatePaymentMethodSchema = CreatePaymentMethodSchema.partial().openapi('UpdatePaymentMethodInput');