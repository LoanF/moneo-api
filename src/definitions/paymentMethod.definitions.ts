import {createRoute, z} from '@hono/zod-openapi';
import {PaymentMethodResponseSchema, CreatePaymentMethodSchema, UpdatePaymentMethodSchema} from '../schemas/paymentMethod.schema.js';
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
        201: { content: { 'application/json': { schema: PaymentMethodResponseSchema } }, description: 'Créé' },
        200: { content: { 'application/json': { schema: PaymentMethodResponseSchema } }, description: 'Déjà existant' },
        400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Erreur' },
        500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Erreur interne' }
    }
});


export const updatePaymentMethodRoute = createRoute({
    method: 'patch',
    path: '/{id}',
    summary: 'Modifier un moyen de paiement',
    tags: ['Moyens de Paiement'],
    security: [{ Bearer: [] }],
    request: {
        params: z.object({ id: z.string() }),
        body: { content: { 'application/json': { schema: UpdatePaymentMethodSchema } } }
    },
    responses: {
        200: { content: { 'application/json': { schema: PaymentMethodResponseSchema } }, description: 'Modifié' },
        404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Non trouvé' }
    }
});

export const deletePaymentMethodRoute = createRoute({
    method: 'delete',
    path: '/{id}',
    summary: 'Supprimer un moyen de paiement',
    tags: ['Moyens de Paiement'],
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.boolean() }) } }, description: 'Supprimé' },
        404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Non trouvé' }
    }
});