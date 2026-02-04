import { createRoute } from '@hono/zod-openapi';
import {AccountSchema, CreateAccountSchema} from "../schemas/account.schema.js";
import {ErrorSchema} from "../schemas/auth.schema.js";

export const listAccountsRoute = createRoute({
    method: 'get',
    path: '/',
    tags: ['Comptes'],
    summary: "Lister les comptes de l'utilisateur",
    security: [{ Bearer: [] }],
    responses: {
        200: { content: { 'application/json': { schema: AccountSchema.array() } }, description: 'Liste des comptes' }
    }
});

export const createAccountRoute = createRoute({
    method: 'post',
    path: '/',
    tags: ['Comptes'],
    summary: "Créer un nouveau compte",
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: CreateAccountSchema } } } },
    responses: {
        201: { content: { 'application/json': { schema: AccountSchema } }, description: 'Compte créé' },
        400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Erreur' }
    }
});