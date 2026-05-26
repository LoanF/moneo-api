import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../types.js';

vi.mock('../middleware/auth.js', () => ({
    authMiddleware: async (c: any, next: any) => {
        c.set('jwtPayload', { id: 'user-123', email: 'test@test.com', exp: 9999999999 });
        await next();
    },
}));

vi.mock('../models/MonthlyPayment.js', () => ({
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

import MonthlyPayment from '../models/MonthlyPayment.js';
import monthlyPaymentRoutes from './monthlyPayment.js';

const app = new OpenAPIHono<AppEnv>();
app.route('/', monthlyPaymentRoutes);

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const ACC_UUID = '550e8400-e29b-41d4-a716-446655440001';

const makePayment = (data: Record<string, any>) => ({
    ...data,
    update: vi.fn().mockImplementation(function (this: any, d: any) {
        Object.assign(this, d);
        return Promise.resolve();
    }),
});

const validBody = {
    id: VALID_UUID,
    name: 'Loyer',
    amount: 800,
    accountId: ACC_UUID,
    dayOfMonth: 1,
    type: 'expense',
};

describe('GET / — lister les paiements mensuels', () => {
    beforeEach(() => vi.clearAllMocks());

    it('retourne 200 avec la liste des paiements', async () => {
        vi.mocked(MonthlyPayment.findAll).mockResolvedValue([
            makePayment({ id: VALID_UUID, name: 'Loyer', amount: 800, userId: 'user-123' }) as any,
        ]);

        const res = await app.request('/');
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(Array.isArray(data)).toBe(true);
        expect(data[0].id).toBe(VALID_UUID);
    });

    it('retourne un tableau vide si aucun paiement', async () => {
        vi.mocked(MonthlyPayment.findAll).mockResolvedValue([]);
        const res = await app.request('/');
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual([]);
    });

    it('filtre par userId de l\'utilisateur connecté', async () => {
        vi.mocked(MonthlyPayment.findAll).mockResolvedValue([]);
        await app.request('/');
        expect(MonthlyPayment.findAll).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ userId: 'user-123' }) })
        );
    });
});

describe('POST / — créer un paiement mensuel', () => {
    beforeEach(() => vi.clearAllMocks());

    it('crée un nouveau paiement et retourne 201', async () => {
        const newPayment = makePayment({ ...validBody, userId: 'user-123' });
        vi.mocked(MonthlyPayment.findOrCreate).mockResolvedValue([newPayment as any, true]);

        const res = await app.request('/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(validBody),
        });

        expect(res.status).toBe(201);
    });

    it('retourne 200 si le paiement existe déjà (idempotence)', async () => {
        const existing = makePayment({ ...validBody, userId: 'user-123' });
        vi.mocked(MonthlyPayment.findOrCreate).mockResolvedValue([existing as any, false]);

        const res = await app.request('/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(validBody),
        });

        expect(res.status).toBe(200);
    });

    it('crée un paiement de type income', async () => {
        const incomePayment = makePayment({ ...validBody, type: 'income', userId: 'user-123' });
        vi.mocked(MonthlyPayment.findOrCreate).mockResolvedValue([incomePayment as any, true]);

        const res = await app.request('/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...validBody, type: 'income' }),
        });

        expect(res.status).toBe(201);
    });

    it('retourne 400 si dayOfMonth est supérieur à 31', async () => {
        const res = await app.request('/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...validBody, dayOfMonth: 32 }),
        });
        expect(res.status).toBe(400);
    });

    it('retourne 400 si dayOfMonth est inférieur à 1', async () => {
        const res = await app.request('/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...validBody, dayOfMonth: 0 }),
        });
        expect(res.status).toBe(400);
    });

    it('retourne 400 si id est manquant', async () => {
        const { id: _id, ...bodyWithoutId } = validBody;
        const res = await app.request('/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyWithoutId),
        });
        expect(res.status).toBe(400);
    });

    it('retourne 500 si une erreur interne survient', async () => {
        vi.mocked(MonthlyPayment.findOrCreate).mockRejectedValue(new Error('DB error'));

        const res = await app.request('/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(validBody),
        });

        expect(res.status).toBe(500);
    });
});

describe('PATCH /:id — modifier un paiement mensuel', () => {
    beforeEach(() => vi.clearAllMocks());

    it('met à jour un paiement et retourne 200', async () => {
        const mockPayment = makePayment({ id: VALID_UUID, name: 'Loyer', amount: 800, userId: 'user-123' });
        vi.mocked(MonthlyPayment.findOne).mockResolvedValue(mockPayment as any);

        const res = await app.request(`/${VALID_UUID}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: 900 }),
        });

        expect(res.status).toBe(200);
        expect(mockPayment.update).toHaveBeenCalledWith({ amount: 900 });
    });

    it('met à jour le nom et le dayOfMonth simultanément', async () => {
        const mockPayment = makePayment({ id: VALID_UUID, name: 'Loyer', amount: 800, dayOfMonth: 1, userId: 'user-123' });
        vi.mocked(MonthlyPayment.findOne).mockResolvedValue(mockPayment as any);

        const res = await app.request(`/${VALID_UUID}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Loyer actualisé', dayOfMonth: 5 }),
        });

        expect(res.status).toBe(200);
        expect(mockPayment.update).toHaveBeenCalledWith({ name: 'Loyer actualisé', dayOfMonth: 5 });
    });

    it("retourne 404 si le paiement n'existe pas", async () => {
        vi.mocked(MonthlyPayment.findOne).mockResolvedValue(null);

        const res = await app.request(`/${VALID_UUID}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: 900 }),
        });

        expect(res.status).toBe(404);
    });
});

describe('DELETE /:id — supprimer un paiement mensuel', () => {
    beforeEach(() => vi.clearAllMocks());

    it('supprime un paiement et retourne 200', async () => {
        vi.mocked(MonthlyPayment.destroy).mockResolvedValue(1);

        const res = await app.request(`/${VALID_UUID}`, { method: 'DELETE' });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
    });

    it("retourne 404 si le paiement n'existe pas", async () => {
        vi.mocked(MonthlyPayment.destroy).mockResolvedValue(0);

        const res = await app.request(`/${VALID_UUID}`, { method: 'DELETE' });
        expect(res.status).toBe(404);
    });

    it('transmet userId pour éviter la suppression cross-user', async () => {
        vi.mocked(MonthlyPayment.destroy).mockResolvedValue(1);

        await app.request(`/${VALID_UUID}`, { method: 'DELETE' });

        expect(MonthlyPayment.destroy).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ userId: 'user-123' }) })
        );
    });
});
