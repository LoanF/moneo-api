import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../types.js';

vi.mock('../middleware/auth.js', () => ({
    authMiddleware: async (c: any, next: any) => {
        c.set('jwtPayload', { id: 'user-123', email: 'test@test.com', exp: 9999999999 });
        await next();
    },
}));

vi.mock('../models/Transaction.js', () => ({
    default: {
        findAndCountAll: vi.fn(),
        findOrCreate: vi.fn(),
        findOne: vi.fn(),
        create: vi.fn(),
        findAll: vi.fn(),
    },
}));

vi.mock('../models/BankAccount.js', () => ({
    default: { findByPk: vi.fn(), findOne: vi.fn() },
}));

vi.mock('../models/Category.js', () => ({ default: {} }));

vi.mock('../models/User.js', () => ({
    default: { findByPk: vi.fn() },
}));

vi.mock('../config/database.js', () => ({
    default: { transaction: vi.fn(), addHook: vi.fn() },
}));

vi.mock('../utils/logger.js', () => ({
    logger: { info: vi.fn(), error: vi.fn() },
}));

vi.mock('../services/fcmService.js', () => ({
    sendPushNotification: vi.fn(),
}));

import Transaction from '../models/Transaction.js';
import BankAccount from '../models/BankAccount.js';
import User from '../models/User.js';
import sequelize from '../config/database.js';
import transactionRoutes from './transaction.js';

const app = new OpenAPIHono<AppEnv>();
app.route('/', transactionRoutes);

const TX_UUID = '550e8400-e29b-41d4-a716-446655440001';
const ACC_UUID = '550e8400-e29b-41d4-a716-446655440002';
const ACC_UUID_2 = '550e8400-e29b-41d4-a716-446655440003';

const mockTransaction = () => ({
    commit: vi.fn(),
    rollback: vi.fn(),
});

describe('GET / — lister les transactions', () => {
    beforeEach(() => vi.clearAllMocks());

    it('retourne 200 avec les transactions et X-Total-Count', async () => {
        vi.mocked(Transaction.findAndCountAll).mockResolvedValue({
            rows: [{ id: TX_UUID, amount: 50, type: 'expense' }] as any,
            count: 1,
        } as any);

        const res = await app.request('/');
        expect(res.status).toBe(200);
        expect(res.headers.get('X-Total-Count')).toBe('1');
        const data = await res.json();
        expect(data).toHaveLength(1);
    });

    it('retourne un tableau vide si aucune transaction', async () => {
        vi.mocked(Transaction.findAndCountAll).mockResolvedValue({ rows: [] as any, count: 0 } as any);

        const res = await app.request('/');
        expect(res.status).toBe(200);
        expect(res.headers.get('X-Total-Count')).toBe('0');
    });

    it('accepte les paramètres limit, offset et accountId', async () => {
        vi.mocked(Transaction.findAndCountAll).mockResolvedValue({ rows: [] as any, count: 0 } as any);

        const res = await app.request(`/?limit=10&offset=5&accountId=${ACC_UUID}`);
        expect(res.status).toBe(200);
        expect(Transaction.findAndCountAll).toHaveBeenCalledWith(
            expect.objectContaining({ limit: 10, offset: 5 })
        );
    });
});

describe('POST / — créer une transaction', () => {
    beforeEach(() => vi.clearAllMocks());

    it('crée une dépense et décrémente le solde du compte', async () => {
        const t = mockTransaction();
        vi.mocked(sequelize.transaction).mockResolvedValue(t as any);

        const mockAccount = { id: ACC_UUID, balance: 1000, save: vi.fn() };
        const mockTx = { id: TX_UUID, amount: 50, type: 'expense' };

        vi.mocked(Transaction.findOrCreate).mockResolvedValue([mockTx as any, true]);
        vi.mocked(BankAccount.findByPk).mockResolvedValue(mockAccount as any);
        vi.mocked(User.findByPk).mockResolvedValue(null);

        const res = await app.request('/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: TX_UUID, accountId: ACC_UUID, amount: 50, type: 'expense' }),
        });

        expect(res.status).toBe(201);
        expect(mockAccount.balance).toBe(950);
        expect(t.commit).toHaveBeenCalled();
    });

    it('crée un revenu et incrémente le solde du compte', async () => {
        const t = mockTransaction();
        vi.mocked(sequelize.transaction).mockResolvedValue(t as any);

        const mockAccount = { id: ACC_UUID, balance: 1000, save: vi.fn() };
        const mockTx = { id: TX_UUID, amount: 200, type: 'income' };

        vi.mocked(Transaction.findOrCreate).mockResolvedValue([mockTx as any, true]);
        vi.mocked(BankAccount.findByPk).mockResolvedValue(mockAccount as any);
        vi.mocked(User.findByPk).mockResolvedValue(null);

        const res = await app.request('/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: TX_UUID, accountId: ACC_UUID, amount: 200, type: 'income' }),
        });

        expect(res.status).toBe(201);
        expect(mockAccount.balance).toBe(1200);
    });

    it('retourne 200 si la transaction est idempotente (déjà existante)', async () => {
        const t = mockTransaction();
        vi.mocked(sequelize.transaction).mockResolvedValue(t as any);

        const existing = { id: TX_UUID, amount: 50, type: 'expense' };
        vi.mocked(Transaction.findOrCreate).mockResolvedValue([existing as any, false]);

        const res = await app.request('/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: TX_UUID, accountId: ACC_UUID, amount: 50, type: 'expense' }),
        });

        expect(res.status).toBe(200);
        expect(t.rollback).toHaveBeenCalled();
    });

    it('retourne 404 si le compte est introuvable', async () => {
        const t = mockTransaction();
        vi.mocked(sequelize.transaction).mockResolvedValue(t as any);

        vi.mocked(Transaction.findOrCreate).mockResolvedValue([{ id: TX_UUID } as any, true]);
        vi.mocked(BankAccount.findByPk).mockResolvedValue(null);

        const res = await app.request('/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: TX_UUID, accountId: ACC_UUID, amount: 50, type: 'expense' }),
        });

        expect(res.status).toBe(404);
        expect(t.rollback).toHaveBeenCalled();
    });
});

describe('DELETE /:id — supprimer une transaction', () => {
    beforeEach(() => vi.clearAllMocks());

    it('supprime une dépense et restaure le solde (annulation inverse)', async () => {
        const t = mockTransaction();
        vi.mocked(sequelize.transaction).mockResolvedValue(t as any);

        const mockAccount = { id: ACC_UUID, balance: 950, save: vi.fn() };
        const mockTx = { id: TX_UUID, accountId: ACC_UUID, amount: 50, type: 'expense', destroy: vi.fn() };

        vi.mocked(Transaction.findOne).mockResolvedValue(mockTx as any);
        vi.mocked(BankAccount.findByPk).mockResolvedValue(mockAccount as any);

        const res = await app.request(`/${TX_UUID}`, { method: 'DELETE' });

        expect(res.status).toBe(200);
        expect(mockAccount.balance).toBe(1000);
        expect(mockTx.destroy).toHaveBeenCalled();
        expect(t.commit).toHaveBeenCalled();
    });

    it('supprime un revenu et décrémente le solde (annulation inverse)', async () => {
        const t = mockTransaction();
        vi.mocked(sequelize.transaction).mockResolvedValue(t as any);

        const mockAccount = { id: ACC_UUID, balance: 1200, save: vi.fn() };
        const mockTx = { id: TX_UUID, accountId: ACC_UUID, amount: 200, type: 'income', destroy: vi.fn() };

        vi.mocked(Transaction.findOne).mockResolvedValue(mockTx as any);
        vi.mocked(BankAccount.findByPk).mockResolvedValue(mockAccount as any);

        const res = await app.request(`/${TX_UUID}`, { method: 'DELETE' });

        expect(res.status).toBe(200);
        expect(mockAccount.balance).toBe(1000);
    });

    it('retourne 404 si la transaction est introuvable', async () => {
        const t = mockTransaction();
        vi.mocked(sequelize.transaction).mockResolvedValue(t as any);
        vi.mocked(Transaction.findOne).mockResolvedValue(null);

        const res = await app.request(`/${TX_UUID}`, { method: 'DELETE' });
        expect(res.status).toBe(404);
        expect(t.rollback).toHaveBeenCalled();
    });
});

describe('POST /transfer — transfert entre comptes', () => {
    beforeEach(() => vi.clearAllMocks());

    it('effectue un transfert et met à jour les deux soldes', async () => {
        const t = mockTransaction();
        vi.mocked(sequelize.transaction).mockResolvedValue(t as any);

        const fromAccount = { id: ACC_UUID, name: 'Courant', balance: 1000, save: vi.fn() };
        const toAccount = { id: ACC_UUID_2, name: 'Épargne', balance: 500, save: vi.fn() };
        const fromTx = { id: TX_UUID, amount: 200, type: 'transfer' };
        const toTx = { id: '550e8400-e29b-41d4-a716-446655440099', amount: 200, type: 'transfer' };

        vi.mocked(BankAccount.findOne)
            .mockResolvedValueOnce(fromAccount as any)
            .mockResolvedValueOnce(toAccount as any);
        vi.mocked(Transaction.create)
            .mockResolvedValueOnce(fromTx as any)
            .mockResolvedValueOnce(toTx as any);

        const res = await app.request('/transfer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fromAccountId: ACC_UUID, toAccountId: ACC_UUID_2, amount: 200 }),
        });

        expect(res.status).toBe(201);
        expect(fromAccount.balance).toBe(800);
        expect(toAccount.balance).toBe(700);
        expect(t.commit).toHaveBeenCalled();
    });

    it('retourne 404 si un des comptes est introuvable', async () => {
        const t = mockTransaction();
        vi.mocked(sequelize.transaction).mockResolvedValue(t as any);
        vi.mocked(BankAccount.findOne).mockResolvedValue(null);

        const res = await app.request('/transfer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fromAccountId: ACC_UUID, toAccountId: ACC_UUID_2, amount: 200 }),
        });

        expect(res.status).toBe(404);
        expect(t.rollback).toHaveBeenCalled();
    });
});
