import { verify } from 'hono/jwt';
import type { Context, Next } from 'hono';

export const authMiddleware = async (c: Context, next: Next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader) return c.json({ error: "Manquant" }, 401);

    const token = authHeader.split(' ')[1];
    try {
        const payload = await verify(token, process.env.ACCESS_TOKEN_SECRET!, 'HS256');
        c.set('jwtPayload', payload);
        c.set('user', payload);
        await next();
    } catch (e) {
        return c.json({ error: "Token invalide" }, 401);
    }
};