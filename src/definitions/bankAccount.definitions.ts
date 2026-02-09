import {createRoute, z} from '@hono/zod-openapi';
import {BankAccountResponseSchema, CreateBankAccountSchema, UpdateBankAccountSchema} from "../schemas/bankAccount.schema.js";
import {ErrorSchema} from "../schemas/auth.schema.js";

export const listBankAccountsRoute = createRoute({
    method: 'get',
    path: '/',
    tags: ['Comptes'],
    summary: "Lister les comptes de l'utilisateur",
    security: [{ Bearer: [] }],
    responses: {
        200: { content: { 'application/json': { schema: BankAccountResponseSchema.array() } }, description: 'Liste des comptes' }
    }
});

export const createBankAccountRoute = createRoute({
    method: 'post',
    path: '/',
    tags: ['Comptes'],
    summary: "Créer un nouveau compte",
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: CreateBankAccountSchema } } } },
    responses: {
        201: { content: { 'application/json': { schema: BankAccountResponseSchema } }, description: 'Compte créé' },
        200: { content: { 'application/json': { schema: BankAccountResponseSchema } }, description: 'Compte déjà existant' },
        400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Erreur' }
    }
});

export const updateBankAccountRoute = createRoute({
    method: 'patch',
    path: '/{id}',
    summary: 'Modifier un compte bancaire',
    tags: ['Accounts'],
    security: [{ Bearer: [] }],
    request: {
        params: z.object({
            id: z.string().openapi({ example: '1' })
        }),
        body: {
            content: { 'application/json': { schema: UpdateBankAccountSchema } }
        }
    },
    responses: {
        200: {
            content: { 'application/json': { schema: BankAccountResponseSchema } },
            description: 'Compte mis à jour avec succès'
        },

        400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Erreur de validation' },
        404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Compte non trouvé' }
    }
});

export const deleteBankAccountRoute = createRoute({
    method: 'delete',
    path: '/{id}',
    summary: 'Supprimer un compte et ses données liées',
    tags: ['Accounts'],
    security: [{ Bearer: [] }],
    request: {
        params: z.object({
            id: z.string().openapi({ example: '1' })
        })
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
            description: 'Compte et transactions supprimés'
        },
        404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Compte non trouvé' },
        400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Erreur lors de la suppression' }
    }
});