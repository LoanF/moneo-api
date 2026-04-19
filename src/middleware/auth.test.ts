import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../types.js';

vi.mock('hono/jwt', () => ({
    verify: vi.fn(),
    sign: vi.fn(),
}));

import { verify } from 'hono/jwt';
import { authMiddleware } from './auth.js';

const buildApp = () => {
    const app = new Hono<AppEnv>();
    app.use('*', authMiddleware);
    app.get('/protected', (c) => c.json({ user: c.get('jwtPayload') }));
    return app;
};

describe('authMiddleware', () => {
    beforeEach(() => vi.clearAllMocks());

    it('retourne 401 si le header Authorization est absent', async () => {
        const res = await buildApp().request('/protected');
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body).toHaveProperty('error');
    });

    it('retourne 401 si le token Bearer est vide ou invalide', async () => {
        vi.mocked(verify).mockRejectedValue(new Error('invalid token'));
        const res = await buildApp().request('/protected', {
            headers: { Authorization: 'Bearer token-invalide-ou-vide' },
        });
        expect(res.status).toBe(401);
    });

    it('retourne 401 si le token JWT est invalide ou expiré', async () => {
        vi.mocked(verify).mockRejectedValue(new Error('jwt expired'));
        const res = await buildApp().request('/protected', {
            headers: { Authorization: 'Bearer token-invalide' },
        });
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error).toBeDefined();
    });

    it('passe le payload JWT dans le contexte si le token est valide', async () => {
        const mockPayload = { id: 'user-abc', email: 'test@example.com', exp: 9999999999 };
        vi.mocked(verify).mockResolvedValue(mockPayload as any);

        const res = await buildApp().request('/protected', {
            headers: { Authorization: 'Bearer token-valide' },
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.user.id).toBe('user-abc');
        expect(body.user.email).toBe('test@example.com');
    });

    it('appelle verify avec le bon secret depuis les variables d\'environnement', async () => {
        process.env.ACCESS_TOKEN_SECRET = 'mon-secret-test';
        vi.mocked(verify).mockResolvedValue({ id: 'u1', email: 'a@b.com', exp: 99 } as any);

        await buildApp().request('/protected', {
            headers: { Authorization: 'Bearer mon-token' },
        });

        expect(verify).toHaveBeenCalledWith('mon-token', 'mon-secret-test', 'HS256');
    });
});
