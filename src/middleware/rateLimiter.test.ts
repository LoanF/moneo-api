import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createRateLimiter } from './rateLimiter.js';

const buildApp = (maxRequests: number, windowMs: number) => {
    const app = new Hono();
    app.use('/test', createRateLimiter(maxRequests, windowMs));
    app.get('/test', (c) => c.json({ ok: true }, 200));
    return app;
};

describe('createRateLimiter', () => {
    it('1ère requête passe (200)', async () => {
        const app = buildApp(3, 60000);
        const res = await app.fetch(new Request('http://localhost/test'));
        expect(res.status).toBe(200);
    });

    it('N requêtes sous la limite passent toutes', async () => {
        const app = buildApp(3, 60000);
        for (let i = 0; i < 3; i++) {
            const res = await app.fetch(new Request('http://localhost/test'));
            expect(res.status).toBe(200);
        }
    });

    it('requête au-delà de la limite → 429 avec Retry-After', async () => {
        const app = buildApp(3, 60000);
        for (let i = 0; i < 3; i++) {
            await app.fetch(new Request('http://localhost/test'));
        }
        const res = await app.fetch(new Request('http://localhost/test'));
        expect(res.status).toBe(429);
        expect(res.headers.get('Retry-After')).toBeTruthy();
    });

    it('après le window, le compteur se réinitialise', async () => {
        vi.useFakeTimers();
        const app = buildApp(2, 1000);

        await app.fetch(new Request('http://localhost/test'));
        await app.fetch(new Request('http://localhost/test'));

        const blocked = await app.fetch(new Request('http://localhost/test'));
        expect(blocked.status).toBe(429);

        vi.advanceTimersByTime(1100);

        const res = await app.fetch(new Request('http://localhost/test'));
        expect(res.status).toBe(200);

        vi.useRealTimers();
    });

    it('utilise x-forwarded-for comme clé de rate limit', async () => {
        const app = buildApp(2, 60000);
        const headers = { 'x-forwarded-for': '1.2.3.4' };

        await app.fetch(new Request('http://localhost/test', { headers }));
        await app.fetch(new Request('http://localhost/test', { headers }));

        // IP différente → pas bloquée
        const otherIp = await app.fetch(
            new Request('http://localhost/test', { headers: { 'x-forwarded-for': '5.6.7.8' } })
        );
        expect(otherIp.status).toBe(200);

        // Même IP → bloquée
        const sameIp = await app.fetch(new Request('http://localhost/test', { headers }));
        expect(sameIp.status).toBe(429);
    });
});
