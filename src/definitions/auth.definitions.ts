import {createRoute, z} from '@hono/zod-openapi';
import {RegisterSchema, AuthResponseSchema, ErrorSchema, LoginSchema, GoogleSchema, RefreshSchema, RefreshResponseSchema} from '../schemas/auth.schema.js';
import {BankAccountResponseSchema, CreateBankAccountSchema} from "../schemas/bankAccountResponseSchema.js";

export const registerRoute = createRoute({
    method: 'post',
    path: '/register',
    tags: ['Authentification'],
    summary: "Inscription",
    request: { body: { content: { 'application/json': { schema: RegisterSchema } } } },
    responses: {
        201: { content: { 'application/json': { schema: AuthResponseSchema } }, description: 'Succès' },
        400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Erreur' }
    }
});

export const loginRoute = createRoute({
    method: 'post',
    path: '/login',
    tags: ['Authentification'],
    summary: "Connexion classique",
    request: { body: { content: { 'application/json': { schema: LoginSchema } } } },
    responses: {
        200: { content: { 'application/json': { schema: AuthResponseSchema } }, description: 'Succès' },
        401: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Identifiants incorrects' }
    }
});

export const googleRoute = createRoute({
    method: 'post',
    path: '/google',
    tags: ['Authentification'],
    // security: [{ Bearer: [] }],
    summary: "Authentification Google",
    request: { body: { content: { 'application/json': { schema: GoogleSchema } } } },
    responses: {
        200: { content: { 'application/json': { schema: AuthResponseSchema } }, description: 'Succès' },
        403: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Échec Google' }
    }
});

export const refreshRoute = createRoute({
    method: 'post',
    path: '/refresh',
    tags: ['Authentification'],
    summary: "Rafraîchir les tokens",
    request: { body: { content: { 'application/json': { schema: RefreshSchema } } } },
    responses: {
        200: { content: { 'application/json': { schema: RefreshResponseSchema } }, description: 'Succès' },
        401: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Token manquant' },
        403: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Token invalide' }
    }
});

export const updateProfileRoute = createRoute({
    method: 'patch',
    path: '/profile',
    summary: 'Mettre à jour le profil',
    tags: ['Auth'],
    security: [{ Bearer: [] }],
    request: {
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        displayName: z.string().optional(),
                        photoURL: z.string().optional(),
                        hasCompletedSetup: z.boolean().optional(),
                    })
                }
            }
        }
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.boolean() }) } },
            description: 'Profil mis à jour'
        }
    }
});

export const uploadAvatarRoute = createRoute({
    method: 'post',
    path: '/upload-avatar',
    summary: 'Uploader une photo de profil',
    tags: ['Auth'],
    security: [{ Bearer: [] }],
    request: {
        body: {
            content: {
                'multipart/form-data': {
                    schema: z.object({
                        avatar: z.any().openapi({ type: 'string', format: 'binary' })
                    })
                }
            }
        }
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ url: z.string() }) } },
            description: 'Image uploadée avec succès'
        },
        400: {
            content: { 'application/json': { schema: ErrorSchema } },
            description: 'Requête invalide ou fichier manquant'
        }
    }
});

export const updateAccountSchema = CreateBankAccountSchema.partial();

export const updateAccountRoute = createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Accounts'],
    security: [{ Bearer: [] }],
    request: {
        params: z.object({ id: z.string() }),
        body: { content: { 'application/json': { schema: updateAccountSchema } } }
    },
    responses: {
        200: { content: { 'application/json': { schema: BankAccountResponseSchema } }, description: 'Modifié' },
        404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Non trouvé' }
    }
});