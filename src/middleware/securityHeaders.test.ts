import { describe, it, expect, afterEach } from 'vitest';
import { Hono } from 'hono';
import { securityHeaders } from './securityHeaders.js';

const buildApp = () => {
    const app = new Hono();
    app.use('*', securityHeaders);
    app.get('/test', (c) => c.json({ ok: true }));
    return app;
};

describe('securityHeaders middleware', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
        process.env.NODE_ENV = originalEnv;
    });

    it('ajoute X-Content-Type-Options: nosniff', async () => {
        const res = await buildApp().request('/test');
        expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('ajoute X-Frame-Options: DENY', async () => {
        const res = await buildApp().request('/test');
        expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    });

    it('ajoute X-XSS-Protection', async () => {
        const res = await buildApp().request('/test');
        expect(res.headers.get('X-XSS-Protection')).toBe('1; mode=block');
    });

    it('ajoute Referrer-Policy: no-referrer', async () => {
        const res = await buildApp().request('/test');
        expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    });

    it('ajoute Permissions-Policy', async () => {
        const res = await buildApp().request('/test');
        expect(res.headers.get('Permissions-Policy')).toContain('geolocation=()');
    });

    it("n'ajoute pas HSTS en développement", async () => {
        process.env.NODE_ENV = 'development';
        const res = await buildApp().request('/test');
        expect(res.headers.get('Strict-Transport-Security')).toBeNull();
    });

    it('ajoute HSTS en production', async () => {
        process.env.NODE_ENV = 'production';
        const res = await buildApp().request('/test');
        expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=31536000');
    });

    it('ne modifie pas le statut ni le corps de la réponse', async () => {
        const res = await buildApp().request('/test');
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ ok: true });
    });
});
