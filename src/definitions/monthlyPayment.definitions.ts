import { createRoute } from '@hono/zod-openapi';
import { MonthlyPaymentResponseSchema, CreateMonthlyPaymentSchema } from '../schemas/monthlyPayment.schema.js';
import { ErrorSchema } from '../schemas/auth.schema.js';

export const listMonthlyPaymentsRoute = createRoute({
    method: 'get',
    path: '/',
    tags: ['Paiements Mensuels'],
    summary: "Lister les paiements mensuels de l'utilisateur",
    security: [{ Bearer: [] }],
    responses: {
        200: {
            content: { 'application/json': { schema: MonthlyPaymentResponseSchema.array() } },
            description: 'Succès'
        }
    }
});

export const createMonthlyPaymentRoute = createRoute({
    method: 'post',
    path: '/',
    tags: ['Paiements Mensuels'],
    summary: "Créer un nouveau paiement mensuel",
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: CreateMonthlyPaymentSchema } } } },
    responses: {
        201: {
            content: { 'application/json': { schema: MonthlyPaymentResponseSchema } },
            description: 'Créé'
        },
        400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Erreur' }
    }
});