import { verify } from 'hono/jwt';
import type { Context, Next } from 'hono';
import type { AppEnv, JwtPayload } from '../types.js';

export const authMiddleware = async (c: Context<AppEnv>, next: Next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader) return c.json({ error: "Manquant" }, 401);

    const token = authHeader.split(' ')[1];
    try {
        const payload = await verify(token, process.env.ACCESS_TOKEN_SECRET!, 'HS256') as JwtPayload;
        c.set('jwtPayload', payload);
        await next();
    } catch (e) {
        return c.json({ error: "Token invalide" }, 401);
    }
};