import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../types.js';

vi.mock('../middleware/auth.js', () => ({
    authMiddleware: async (c: any, next: any) => {
        c.set('jwtPayload', { id: 'user-123', email: 'test@test.com', exp: 9999999999 });
        await next();
    },
}));

vi.mock('../models/PaymentMethod.js', () => ({
    default: {
        findAll: vi.fn(),
        findOrCreate: vi.fn(),
        findOne: vi.fn(),
        destroy: vi.fn(),
    },
}));

vi.mock('../utils/logger.js', () => ({
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import PaymentMethod from '../models/PaymentMethod.js';
import paymentMethodRoutes from './paymentMethod.js';

const app = new OpenAPIHono<AppEnv>();
app.route('/', paymentMethodRoutes);

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

const makeMethod = (data: Record<string, any>) => ({
    ...data,
    update: vi.fn().mockImplementation(function (this: any, d: any) {
        Object.assign(this, d);
        return Promise.resolve();
    }),
});

const validBody = {
    id: VALID_UUID,
    name: 'Carte bleue',
    type: 'debit',
};

describe('GET / — lister les moyens de paiement', () => {
    beforeEach(() => vi.clearAllMocks());

    it('retourne 200 avec la liste des moyens de paiement', async () => {
        vi.mocked(PaymentMethod.findAll).mockResolvedValue([
            makeMethod({ id: VALID_UUID, name: 'Carte bleue', type: 'debit', userId: 'user-123' }) as any,
        ]);

        const res = await app.request('/');
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(Array.isArray(data)).toBe(true);
        expect(data[0].id).toBe(VALID_UUID);
    });

    it('retourne un tableau vide si aucun moyen de paiement', async () => {
        vi.mocked(PaymentMethod.findAll).mockResolvedValue([]);
        const res = await app.request('/');
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual([]);
    });

    it('filtre par userId de l\'utilisateur connecté', async () => {
        vi.mocked(PaymentMethod.findAll).mockResolvedValue([]);
        await app.request('/');
        expect(PaymentMethod.findAll).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ userId: 'user-123' }) })
        );
    });
});

describe('POST / — créer un moyen de paiement', () => {
    beforeEach(() => vi.clearAllMocks());

    it('crée un nouveau moyen de paiement et retourne 201', async () => {
        const newMethod = makeMethod({ ...validBody, userId: 'user-123' });
        vi.mocked(PaymentMethod.findOrCreate).mockResolvedValue([newMethod as any, true]);

        const res = await app.request('/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(validBody),
        });

        expect(res.status).toBe(201);
    });

    it('retourne 200 si le moyen de paiement existe déjà (idempotence)', async () => {
        const existing = makeMethod({ ...validBody, userId: 'user-123' });
        vi.mocked(PaymentMethod.findOrCreate).mockResolvedValue([existing as any, false]);

        const res = await app.request('/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(validBody),
        });

        expect(res.status).toBe(200);
    });

    it('accepte tous les types valides (credit, cash, transfer, cheque)', async () => {
        const types = ['credit', 'cash', 'transfer', 'cheque'] as const;

        for (const type of types) {
            vi.clearAllMocks();
            const method = makeMethod({ ...validBody, type, userId: 'user-123' });
            vi.mocked(PaymentMethod.findOrCreate).mockResolvedValue([method as any, true]);

            const res = await app.request('/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...validBody, type }),
            });

            expect(res.status).toBe(201);
        }
    });

    it('retourne 400 si name est manquant', async () => {
        const res = await app.request('/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: VALID_UUID, type: 'debit' }),
        });
        expect(res.status).toBe(400);
    });

    it('retourne 400 si id est manquant', async () => {
        const res = await app.request('/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Carte bleue', type: 'debit' }),
        });
        expect(res.status).toBe(400);
    });

    it('retourne 400 si le type est invalide', async () => {
        const res = await app.request('/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...validBody, type: 'bitcoin' }),
        });
        expect(res.status).toBe(400);
    });

    it('retourne 500 si une erreur interne survient', async () => {
        vi.mocked(PaymentMethod.findOrCreate).mockRejectedValue(new Error('DB error'));

        const res = await app.request('/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(validBody),
        });

        expect(res.status).toBe(500);
    });
});

describe('PATCH /:id — modifier un moyen de paiement', () => {
    beforeEach(() => vi.clearAllMocks());

    it('met à jour un moyen de paiement et retourne 200', async () => {
        const mockMethod = makeMethod({ id: VALID_UUID, name: 'Carte bleue', type: 'debit', userId: 'user-123' });
        vi.mocked(PaymentMethod.findOne).mockResolvedValue(mockMethod as any);

        const res = await app.request(`/${VALID_UUID}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Carte Gold' }),
        });

        expect(res.status).toBe(200);
        expect(mockMethod.update).toHaveBeenCalledWith(expect.objectContaining({ name: 'Carte Gold' }));
    });

    it('change le type vers credit', async () => {
        const mockMethod = makeMethod({ id: VALID_UUID, name: 'Carte bleue', type: 'debit', userId: 'user-123' });
        vi.mocked(PaymentMethod.findOne).mockResolvedValue(mockMethod as any);

        const res = await app.request(`/${VALID_UUID}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'credit' }),
        });

        expect(res.status).toBe(200);
        expect(mockMethod.update).toHaveBeenCalledWith({ type: 'credit' });
    });

    it("retourne 404 si le moyen de paiement n'existe pas", async () => {
        vi.mocked(PaymentMethod.findOne).mockResolvedValue(null);

        const res = await app.request(`/${VALID_UUID}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Test' }),
        });

        expect(res.status).toBe(404);
    });
});

describe('DELETE /:id — supprimer un moyen de paiement', () => {
    beforeEach(() => vi.clearAllMocks());

    it('supprime un moyen de paiement et retourne 200', async () => {
        vi.mocked(PaymentMethod.destroy).mockResolvedValue(1);

        const res = await app.request(`/${VALID_UUID}`, { method: 'DELETE' });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
    });

    it("retourne 404 si le moyen de paiement n'existe pas", async () => {
        vi.mocked(PaymentMethod.destroy).mockResolvedValue(0);

        const res = await app.request(`/${VALID_UUID}`, { method: 'DELETE' });
        expect(res.status).toBe(404);
    });

    it('transmet userId pour éviter la suppression cross-user', async () => {
        vi.mocked(PaymentMethod.destroy).mockResolvedValue(1);

        await app.request(`/${VALID_UUID}`, { method: 'DELETE' });

        expect(PaymentMethod.destroy).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ userId: 'user-123' }) })
        );
    });
});
