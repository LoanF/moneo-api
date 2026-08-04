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
        bulkCreate: vi.fn(),
    },
}));

vi.mock('../models/BankAccount.js', () => ({
    default: { findByPk: vi.fn(), findOne: vi.fn(), findAll: vi.fn() },
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
        const mockTx = { id: TX_UUID, amount: -50, type: 'expense' };

        vi.mocked(Transaction.findOrCreate).mockResolvedValue([mockTx as any, true]);
        vi.mocked(BankAccount.findOne).mockResolvedValue(mockAccount as any);
        vi.mocked(User.findByPk).mockResolvedValue(null);

        const res = await app.request('/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: TX_UUID, accountId: ACC_UUID, amount: -50, type: 'expense' }),
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
        vi.mocked(BankAccount.findOne).mockResolvedValue(mockAccount as any);
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
        vi.mocked(BankAccount.findOne).mockResolvedValue(null);

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
        const mockTx = { id: TX_UUID, accountId: ACC_UUID, amount: -50, type: 'expense', destroy: vi.fn() };

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

    it('supprime un transfert et sa transaction jumelée en répercutant les deux soldes', async () => {
        const t = mockTransaction();
        vi.mocked(sequelize.transaction).mockResolvedValue(t as any);

        const fromAccount = { id: ACC_UUID, balance: 800, save: vi.fn() };
        const toAccount = { id: ACC_UUID_2, balance: 700, save: vi.fn() };
        const date = new Date('2024-01-01');
        const mockTx = { id: TX_UUID, accountId: ACC_UUID, amount: -200, type: 'transfer', date, destroy: vi.fn() };
        const pairedTx = { id: '550e8400-e29b-41d4-a716-446655440099', accountId: ACC_UUID_2, amount: 200, type: 'transfer', date, destroy: vi.fn() };

        vi.mocked(Transaction.findOne)
            .mockResolvedValueOnce(mockTx as any)
            .mockResolvedValueOnce(pairedTx as any);
        vi.mocked(BankAccount.findByPk)
            .mockResolvedValueOnce(fromAccount as any)
            .mockResolvedValueOnce(toAccount as any);

        const res = await app.request(`/${TX_UUID}`, { method: 'DELETE' });

        expect(res.status).toBe(200);
        expect(fromAccount.balance).toBe(1000);
        expect(toAccount.balance).toBe(500);
        expect(mockTx.destroy).toHaveBeenCalled();
        expect(pairedTx.destroy).toHaveBeenCalled();
        expect(t.commit).toHaveBeenCalled();
    });

    it('supprime un transfert sans transaction jumelée trouvée', async () => {
        const t = mockTransaction();
        vi.mocked(sequelize.transaction).mockResolvedValue(t as any);

        const account = { id: ACC_UUID, balance: 800, save: vi.fn() };
        const mockTx = { id: TX_UUID, accountId: ACC_UUID, amount: -200, type: 'transfer', date: new Date(), destroy: vi.fn() };

        vi.mocked(Transaction.findOne)
            .mockResolvedValueOnce(mockTx as any)
            .mockResolvedValueOnce(null);
        vi.mocked(BankAccount.findByPk).mockResolvedValueOnce(account as any);

        const res = await app.request(`/${TX_UUID}`, { method: 'DELETE' });

        expect(res.status).toBe(200);
        expect(mockTx.destroy).toHaveBeenCalled();
        expect(t.commit).toHaveBeenCalled();
    });
});

describe('POST /batch — import en masse', () => {
    beforeEach(() => vi.clearAllMocks());

    const item = (overrides: Record<string, unknown> = {}) => ({
        id: TX_UUID,
        accountId: ACC_UUID,
        amount: 50,
        type: 'expense',
        ...overrides,
    });

    it('importe les nouvelles transactions et met à jour le solde du compte', async () => {
        const t = mockTransaction();
        vi.mocked(sequelize.transaction).mockResolvedValue(t as any);

        const account = { id: ACC_UUID, balance: 1000, save: vi.fn() };
        vi.mocked(Transaction.findAll).mockResolvedValue([]);
        vi.mocked(BankAccount.findAll).mockResolvedValue([account as any]);
        vi.mocked(Transaction.bulkCreate).mockResolvedValue([] as any);

        const res = await app.request('/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transactions: [item({ amount: -50 })] }),
        });

        expect(res.status).toBe(201);
        const data = await res.json();
        expect(data).toEqual({ imported: 1 });
        expect(account.balance).toBe(950);
        expect(Transaction.bulkCreate).toHaveBeenCalled();
        expect(t.commit).toHaveBeenCalled();
    });

    it('ignore les transactions déjà existantes (idempotence)', async () => {
        const t = mockTransaction();
        vi.mocked(sequelize.transaction).mockResolvedValue(t as any);
        vi.mocked(Transaction.findAll).mockResolvedValue([{ id: TX_UUID } as any]);

        const res = await app.request('/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transactions: [item()] }),
        });

        expect(res.status).toBe(201);
        const data = await res.json();
        expect(data).toEqual({ imported: 0 });
        expect(t.rollback).toHaveBeenCalled();
        expect(Transaction.bulkCreate).not.toHaveBeenCalled();
    });

    it('retourne 404 si un des comptes ciblés est introuvable', async () => {
        const t = mockTransaction();
        vi.mocked(sequelize.transaction).mockResolvedValue(t as any);
        vi.mocked(Transaction.findAll).mockResolvedValue([]);
        vi.mocked(BankAccount.findAll).mockResolvedValue([]);

        const res = await app.request('/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transactions: [item()] }),
        });

        expect(res.status).toBe(404);
        expect(t.rollback).toHaveBeenCalled();
    });

    it('cumule les montants sur un même compte avant de sauvegarder le solde', async () => {
        const t = mockTransaction();
        vi.mocked(sequelize.transaction).mockResolvedValue(t as any);

        const account = { id: ACC_UUID, balance: 1000, save: vi.fn() };
        vi.mocked(Transaction.findAll).mockResolvedValue([]);
        vi.mocked(BankAccount.findAll).mockResolvedValue([account as any]);
        vi.mocked(Transaction.bulkCreate).mockResolvedValue([] as any);

        const res = await app.request('/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                transactions: [
                    item({ id: TX_UUID, amount: -50 }),
                    item({ id: '550e8400-e29b-41d4-a716-446655440099', amount: 200, type: 'income' }),
                ],
            }),
        });

        expect(res.status).toBe(201);
        expect(account.balance).toBe(1150);
        expect(account.save).toHaveBeenCalledTimes(1);
    });

    it('retourne 500 en cas d\'erreur interne', async () => {
        const t = mockTransaction();
        vi.mocked(sequelize.transaction).mockResolvedValue(t as any);
        vi.mocked(Transaction.findAll).mockRejectedValue(new Error('db down'));

        const res = await app.request('/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transactions: [item()] }),
        });

        expect(res.status).toBe(500);
        expect(t.rollback).toHaveBeenCalled();
    });
});

describe('PATCH /:id — modifier une transaction', () => {
    beforeEach(() => vi.clearAllMocks());

    it('met à jour le montant et ajuste le solde du compte en conséquence', async () => {
        const t = mockTransaction();
        vi.mocked(sequelize.transaction).mockResolvedValue(t as any);

        const account = { id: ACC_UUID, balance: 950, save: vi.fn() };
        const mockTx: any = {
            id: TX_UUID,
            accountId: ACC_UUID,
            amount: -50,
            type: 'expense',
            update: vi.fn(function (this: any, body: any) {
                Object.assign(this, body);
                return Promise.resolve(this);
            }),
        };

        vi.mocked(Transaction.findOne).mockResolvedValue(mockTx as any);
        vi.mocked(BankAccount.findByPk).mockResolvedValue(account as any);

        const res = await app.request(`/${TX_UUID}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: -80 }),
        });

        expect(res.status).toBe(200);
        expect(mockTx.update).toHaveBeenCalledWith(expect.objectContaining({ amount: -80 }), expect.anything());
        expect(account.balance).toBe(920);
        expect(t.commit).toHaveBeenCalled();
    });

    it('retourne 404 si la transaction est introuvable', async () => {
        const t = mockTransaction();
        vi.mocked(sequelize.transaction).mockResolvedValue(t as any);
        vi.mocked(Transaction.findOne).mockResolvedValue(null);

        const res = await app.request(`/${TX_UUID}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: -80 }),
        });

        expect(res.status).toBe(404);
        expect(t.rollback).toHaveBeenCalled();
    });

    it('retourne 404 si le compte bancaire associé est introuvable', async () => {
        const t = mockTransaction();
        vi.mocked(sequelize.transaction).mockResolvedValue(t as any);
        vi.mocked(Transaction.findOne).mockResolvedValue({ id: TX_UUID, accountId: ACC_UUID, amount: -50 } as any);
        vi.mocked(BankAccount.findByPk).mockResolvedValue(null);

        const res = await app.request(`/${TX_UUID}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: -80 }),
        });

        expect(res.status).toBe(404);
        expect(t.rollback).toHaveBeenCalled();
    });

    it('retourne 500 en cas d\'erreur interne', async () => {
        const t = mockTransaction();
        vi.mocked(sequelize.transaction).mockResolvedValue(t as any);
        vi.mocked(Transaction.findOne).mockRejectedValue(new Error('db down'));

        const res = await app.request(`/${TX_UUID}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: -80 }),
        });

        expect(res.status).toBe(500);
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
