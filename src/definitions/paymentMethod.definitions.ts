import { createRoute } from '@hono/zod-openapi';
import { PaymentMethodResponseSchema, CreatePaymentMethodSchema } from '../schemas/paymentMethod.schema.js';
import { ErrorSchema } from '../schemas/auth.schema.js';

export const listPaymentMethodsRoute = createRoute({
    method: 'get',
    path: '/',
    tags: ['Moyens de Paiement'],
    summary: "Lister les moyens de paiement de l'utilisateur",
    security: [{ Bearer: [] }],
    responses: {
        200: {
            content: { 'application/json': { schema: PaymentMethodResponseSchema.array() } },
            description: 'Liste des moyens de paiement'
        }
    }
});

export const createPaymentMethodRoute = createRoute({
    method: 'post',
    path: '/',
    tags: ['Moyens de Paiement'],
    summary: "Créer un nouveau moyen de paiement",
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: CreatePaymentMethodSchema } } } },
    responses: {
        201: {
            content: { 'application/json': { schema: PaymentMethodResponseSchema } },
            description: 'Moyen de paiement créé'
        },
        400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Erreur' }
    }
});