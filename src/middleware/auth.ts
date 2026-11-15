import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../lib/http.js';
import { verifyAccessToken } from '../lib/tokens.js';

export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
    const header = c.req.header('Authorization') ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
        return c.json({ error: 'Authentification requise', code: 'unauthenticated' }, 401);
    }
    try {
        const claims = await verifyAccessToken(token);
        c.set('auth', { userId: claims.sub, sessionId: claims.sid, email: claims.email });
    } catch {
        return c.json({ error: 'Session expirée', code: 'token_expired' }, 401);
    }
    await next();
};
