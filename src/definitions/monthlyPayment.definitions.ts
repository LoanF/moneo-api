import {createRoute, z} from '@hono/zod-openapi';
import {MonthlyPaymentResponseSchema, CreateMonthlyPaymentSchema, UpdateMonthlyPaymentSchema} from '../schemas/monthlyPayment.schema.js';
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
        201: { content: { 'application/json': { schema: MonthlyPaymentResponseSchema } }, description: 'Créé' },
        200: { content: { 'application/json': { schema: MonthlyPaymentResponseSchema } }, description: 'Déjà existant' },
        400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Erreur' }
    }
});

export const updateMonthlyPaymentRoute = createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Paiements Mensuels'],
    security: [{ Bearer: [] }],
    request: {
        params: z.object({ id: z.string() }),
        body: { content: { 'application/json': { schema: UpdateMonthlyPaymentSchema } } }
    },
    responses: {
        200: { content: { 'application/json': { schema: MonthlyPaymentResponseSchema } }, description: 'Modifié' },
        404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Non trouvé' }
    }
});

export const deleteMonthlyPaymentRoute = createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['Paiements Mensuels'],
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.boolean() }) } }, description: 'Supprimé' },
        404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Non trouvé' }
    }
});