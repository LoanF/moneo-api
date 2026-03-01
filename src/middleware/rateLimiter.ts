import type { MiddlewareHandler } from 'hono';

interface RateLimitEntry {
    count: number;
    resetAt: number;
}

export const createRateLimiter = (maxRequests: number, windowMs: number): MiddlewareHandler => {
    const store = new Map<string, RateLimitEntry>();

    return async (c, next) => {
        const ip =
            c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
            c.req.header('x-real-ip') ||
            'unknown';

        const now = Date.now();
        const entry = store.get(ip);

        if (!entry || now >= entry.resetAt) {
            store.set(ip, { count: 1, resetAt: now + windowMs });
            return next();
        }

        if (entry.count >= maxRequests) {
            const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
            c.header('Retry-After', String(retryAfter));
            return c.json({ error: 'Trop de requêtes, veuillez réessayer plus tard.' }, 429);
        }

        entry.count++;
        return next();
    };
};
