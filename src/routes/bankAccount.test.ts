import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../types.js';

vi.mock('../middleware/auth.js', () => ({
    authMiddleware: async (c: any, next: any) => {
        c.set('jwtPayload', { id: 'user-123', email: 'test@test.com', exp: 9999999999 });
        await next();
    },
}));

vi.mock('../models/BankAccount.js', () => ({
    default: {
        findAll: vi.fn(),
        findOrCreate: vi.fn(),
        findOne: vi.fn(),
        max: vi.fn(),
    },
}));

vi.mock('../models/Transaction.js', () => ({
    default: { destroy: vi.fn(), findAll: vi.fn() },
}));

vi.mock('../models/MonthlyPayment.js', () => ({
    default: { destroy: vi.fn() },
}));

vi.mock('../config/database.js', () => ({
    default: { transaction: vi.fn(), addHook: vi.fn() },
}));

vi.mock('../utils/logger.js', () => ({
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import BankAccount from '../models/BankAccount.js';
import Transaction from '../models/Transaction.js';
import sequelize from '../config/database.js';
import accountRoutes from './bankAccount.js';

const app = new OpenAPIHono<AppEnv>();
app.route('/', accountRoutes);

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

const makeAccount = (data: Record<string, any>) => ({ ...data, toJSON: () => data });

describe('GET / — lister les comptes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(Transaction.findAll).mockResolvedValue([] as any);
    });

    it('retourne 200 avec la liste des comptes', async () => {
        vi.mocked(BankAccount.findAll).mockResolvedValue([
            makeAccount({ id: VALID_UUID, name: 'Compte courant', balance: 1500 }) as any,
        ]);

        const res = await app.request('/');
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(Array.isArray(data)).toBe(true);
        expect(data[0].id).toBe(VALID_UUID);
        expect(data[0].pointedBalance).toBe(1500);
    });

    it('retourne un tableau vide si aucun compte', async () => {
        vi.mocked(BankAccount.findAll).mockResolvedValue([]);
        const res = await app.request('/');
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual([]);
    });
});

describe('POST / — créer un compte', () => {
    beforeEach(() => vi.clearAllMocks());

    it('crée un nouveau compte et retourne 201', async () => {
        vi.mocked(BankAccount.max).mockResolvedValue(0 as any);
        const newAccount = makeAccount({ id: VALID_UUID, name: 'Épargne', balance: 0, currency: 'EUR' });
        vi.mocked(BankAccount.findOrCreate).mockResolvedValue([newAccount as any, true]);

        const res = await app.request('/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: VALID_UUID, name: 'Épargne', balance: 0 }),
        });

        expect(res.status).toBe(201);
    });

    it('retourne 200 si le compte existe déjà (idempotence)', async () => {
        vi.mocked(BankAccount.max).mockResolvedValue(0 as any);
        const existing = makeAccount({ id: VALID_UUID, name: 'Courant', balance: 1000 });
        vi.mocked(BankAccount.findOrCreate).mockResolvedValue([existing as any, false]);

        const res = await app.request('/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: VALID_UUID, name: 'Courant', balance: 1000 }),
        });

        expect(res.status).toBe(200);
    });

    it('retourne 400 si le corps est invalide (id manquant)', async () => {
        const res = await app.request('/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Sans ID' }),
        });
        expect(res.status).toBe(400);
    });
});

describe('PATCH /:id — modifier un compte', () => {
    beforeEach(() => vi.clearAllMocks());

    it('met à jour un compte et retourne 200', async () => {
        const mockAccount = {
            id: VALID_UUID,
            name: 'Courant',
            balance: 2000,
            update: vi.fn().mockImplementation(function (this: any, data: any) {
                Object.assign(this, data);
                return Promise.resolve();
            }),
        };
        vi.mocked(BankAccount.findOne).mockResolvedValue(mockAccount as any);

        const res = await app.request(`/${VALID_UUID}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Nouveau nom' }),
        });

        expect(res.status).toBe(200);
        expect(mockAccount.update).toHaveBeenCalled();
    });

    it('retourne 404 si le compte n\'existe pas', async () => {
        vi.mocked(BankAccount.findOne).mockResolvedValue(null);

        const res = await app.request(`/${VALID_UUID}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Test' }),
        });

        expect(res.status).toBe(404);
    });
});

describe('DELETE /:id — supprimer un compte', () => {
    beforeEach(() => vi.clearAllMocks());

    it('supprime un compte et ses données liées, retourne 200', async () => {
        const mockCommit = vi.fn();
        const mockRollback = vi.fn();
        vi.mocked(sequelize.transaction).mockResolvedValue({
            commit: mockCommit,
            rollback: mockRollback,
        } as any);

        const mockAccount = { id: VALID_UUID, destroy: vi.fn() };
        vi.mocked(BankAccount.findOne).mockResolvedValue(mockAccount as any);

        const res = await app.request(`/${VALID_UUID}`, { method: 'DELETE' });
        expect(res.status).toBe(200);
        expect(mockCommit).toHaveBeenCalled();
        expect(mockAccount.destroy).toHaveBeenCalled();
    });

    it('retourne 404 si le compte n\'existe pas', async () => {
        const mockRollback = vi.fn();
        vi.mocked(sequelize.transaction).mockResolvedValue({
            commit: vi.fn(),
            rollback: mockRollback,
        } as any);
        vi.mocked(BankAccount.findOne).mockResolvedValue(null);

        const res = await app.request(`/${VALID_UUID}`, { method: 'DELETE' });
        expect(res.status).toBe(404);
        expect(mockRollback).toHaveBeenCalled();
    });
});
