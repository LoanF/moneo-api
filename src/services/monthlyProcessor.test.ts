import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node-cron', () => ({
    default: { schedule: vi.fn() },
}));

vi.mock('../utils/logger.js', () => ({
    logger: { info: vi.fn(), error: vi.fn() },
}));

vi.mock('../models/MonthlyPayment.js', () => ({
    default: { findAll: vi.fn() },
}));

vi.mock('../models/Transaction.js', () => ({
    default: { create: vi.fn() },
}));

vi.mock('../models/BankAccount.js', () => ({
    default: { findByPk: vi.fn() },
}));

vi.mock('../config/database.js', () => ({
    default: { transaction: vi.fn() },
}));

import MonthlyPayment from '../models/MonthlyPayment.js';
import Transaction from '../models/Transaction.js';
import BankAccount from '../models/BankAccount.js';
import sequelize from '../config/database.js';
import { processMonthlyPayments } from './monthlyProcessor.js';

describe('processMonthlyPayments', () => {
    const mockCommit = vi.fn();
    const mockRollback = vi.fn();
    const mockTransaction = { commit: mockCommit, rollback: mockRollback };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(sequelize.transaction).mockResolvedValue(mockTransaction as any);
    });

    it('aucun paiement dû → aucune transaction créée', async () => {
        vi.mocked(MonthlyPayment.findAll).mockResolvedValue([]);
        await processMonthlyPayments();
        expect(Transaction.create).not.toHaveBeenCalled();
    });

    it('paiement de type "expense" → balance décrémentée', async () => {
        const mockAccount = { balance: 1000, save: vi.fn() };
        const mockPayment = {
            userId: 'user-1',
            accountId: 'acc-1',
            categoryId: 'cat-1',
            paymentMethodId: 'pm-1',
            amount: 100,
            type: 'expense',
            name: 'Netflix',
            lastProcessed: null,
            save: vi.fn(),
        };

        vi.mocked(MonthlyPayment.findAll).mockResolvedValue([mockPayment as any]);
        vi.mocked(Transaction.create).mockResolvedValue({} as any);
        vi.mocked(BankAccount.findByPk).mockResolvedValue(mockAccount as any);

        await processMonthlyPayments();

        expect(mockAccount.balance).toBe(900);
        expect(mockCommit).toHaveBeenCalledTimes(1);
    });

    it('paiement de type "income" → balance incrémentée', async () => {
        const mockAccount = { balance: 1000, save: vi.fn() };
        const mockPayment = {
            userId: 'user-1',
            accountId: 'acc-1',
            categoryId: 'cat-1',
            paymentMethodId: 'pm-1',
            amount: 200,
            type: 'income',
            name: 'Salaire',
            lastProcessed: null,
            save: vi.fn(),
        };

        vi.mocked(MonthlyPayment.findAll).mockResolvedValue([mockPayment as any]);
        vi.mocked(Transaction.create).mockResolvedValue({} as any);
        vi.mocked(BankAccount.findByPk).mockResolvedValue(mockAccount as any);

        await processMonthlyPayments();

        expect(mockAccount.balance).toBe(1200);
        expect(mockCommit).toHaveBeenCalledTimes(1);
    });

    it('erreur lors du traitement → rollback appelé, pas de commit', async () => {
        const mockPayment = {
            userId: 'user-1',
            accountId: 'acc-1',
            amount: 100,
            type: 'expense',
            name: 'Netflix',
        };

        vi.mocked(MonthlyPayment.findAll).mockResolvedValue([mockPayment as any]);
        vi.mocked(Transaction.create).mockRejectedValue(new Error('DB Error'));

        await processMonthlyPayments();

        expect(mockRollback).toHaveBeenCalledTimes(1);
        expect(mockCommit).not.toHaveBeenCalled();
    });

    it("gestion du dernier jour du mois : s'exécute sans erreur", async () => {
        vi.setSystemTime(new Date('2025-02-28'));
        vi.mocked(MonthlyPayment.findAll).mockResolvedValue([]);

        await expect(processMonthlyPayments()).resolves.not.toThrow();
        expect(MonthlyPayment.findAll).toHaveBeenCalled();

        vi.useRealTimers();
    });
});
