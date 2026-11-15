import { OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';

export type AuthContext = { userId: string; sessionId: string; email: string };
export type AppEnv = { Variables: { auth: AuthContext } };
export type AppContext = Context<AppEnv>;

export const createRouter = (): OpenAPIHono<AppEnv> =>
    new OpenAPIHono<AppEnv>({
        defaultHook: (result, c) => {
            if (!result.success) {
                const messages = [...new Set(result.error.issues.map((i) => i.message))];
                return c.json({ error: messages.join(' • '), code: 'validation_error' }, 400);
            }
        },
    });

export const ErrorSchema = z.object({ error: z.string(), code: z.string().optional() }).openapi('Error');
export const SuccessSchema = z.object({ success: z.boolean() }).openapi('Success');
export const IdParam = z.object({ id: z.uuid('Identifiant invalide') });

// ── Raccourcis pour déclarer les routes OpenAPI ──────────────────────────────

export const json = <T extends z.ZodType>(schema: T, description = 'Succès') => ({
    content: { 'application/json': { schema } },
    description,
});

export const body = <T extends z.ZodType>(schema: T) => ({
    body: { content: { 'application/json': { schema } }, required: true },
});

const err = (description: string) => json(ErrorSchema, description);

/** Réponses d'erreur communes à toutes les routes authentifiées. */
export const errors = {
    400: err('Requête invalide'),
    401: err('Non authentifié'),
    404: err('Introuvable'),
    409: err('Conflit'),
    429: err('Trop de requêtes'),
} as const;

export const secured = [{ Bearer: [] }];
