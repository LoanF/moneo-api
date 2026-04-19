import type { MiddlewareHandler } from 'hono';

export const securityHeaders: MiddlewareHandler = async (c, next) => {
    await next();

    const headers = new Headers(c.res.headers);

    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('X-XSS-Protection', '1; mode=block');
    headers.set('Referrer-Policy', 'no-referrer');
    headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    headers.set('Cross-Origin-Resource-Policy', 'same-origin');

    if (process.env.NODE_ENV === 'production') {
        headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }

    c.res = new Response(c.res.body, {
        status: c.res.status,
        headers,
    });
};
