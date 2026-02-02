import { jwt } from 'hono/jwt';
import type { Context, Next } from 'hono';

export const authMiddleware = async (c: Context, next: Next) => {
    return jwt({
        secret: process.env.ACCESS_TOKEN_SECRET as string,
        alg: 'HS256',
    })(c, next);
};