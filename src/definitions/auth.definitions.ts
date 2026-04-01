import {createRoute, z} from '@hono/zod-openapi';
import {RegisterSchema, AuthResponseSchema, ErrorSchema, LoginSchema, GoogleSchema, RefreshSchema, RefreshResponseSchema, UserSchema, UpdateProfileSchema, VerifyEmailSchema, ForgotPasswordSchema, ResetPasswordSchema} from '../schemas/auth.schema.js';

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
    summary: 'Mettre à jour le profil utilisateur',
    tags: ['Authentification'],
    security: [{ Bearer: [] }],
    request: {
        body: {
            content: {
                'application/json': {
                    schema: UpdateProfileSchema
                }
            }
        }
    },
    responses: {
        200: {
            content: { 'application/json': { schema: UserSchema } },
            description: 'Profil mis à jour avec succès'
        },
        400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Erreur' },
        404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Utilisateur non trouvé' },
        500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Erreur interne' }
    }
});

export const uploadAvatarRoute = createRoute({
    method: 'post',
    path: '/upload-avatar',
    summary: 'Uploader une photo de profil',
    tags: ['Authentification'],
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

export const meRoute = createRoute({
    method: 'get',
    path: '/me',
    summary: 'Récupérer le profil actuel',
    tags: ['Authentification'],
    security: [{ Bearer: [] }],
    responses: {
        200: { content: { 'application/json': { schema: UserSchema } }, description: 'Succès' },
        401: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Non authentifié' }
    }
});

export const logoutRoute = createRoute({
    method: 'post',
    path: '/logout',
    summary: 'Déconnexion',
    tags: ['Authentification'],
    security: [{ Bearer: [] }],
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.boolean() }) } }, description: 'Déconnecté' }
    }
});

export const verifyEmailRoute = createRoute({
    method: 'post',
    path: '/verify-email',
    summary: 'Vérifier l\'adresse email',
    tags: ['Authentification'],
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: VerifyEmailSchema } } } },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.boolean() }) } }, description: 'Email vérifié' },
        400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Code invalide ou expiré' },
    }
});

export const resendVerificationRoute = createRoute({
    method: 'post',
    path: '/resend-verification',
    summary: 'Renvoyer le code de vérification',
    tags: ['Authentification'],
    security: [{ Bearer: [] }],
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.boolean() }) } }, description: 'Code renvoyé' },
        400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Email déjà vérifié' },
    }
});

export const forgotPasswordRoute = createRoute({
    method: 'post',
    path: '/forgot-password',
    summary: 'Demander une réinitialisation de mot de passe',
    tags: ['Authentification'],
    request: { body: { content: { 'application/json': { schema: ForgotPasswordSchema } } } },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.boolean() }) } }, description: 'Code envoyé si l\'email existe' },
    }
});

export const resetPasswordRoute = createRoute({
    method: 'post',
    path: '/reset-password',
    summary: 'Réinitialiser le mot de passe',
    tags: ['Authentification'],
    request: { body: { content: { 'application/json': { schema: ResetPasswordSchema } } } },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.boolean() }) } }, description: 'Mot de passe réinitialisé' },
        400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Code invalide ou expiré' },
    }
});