import { createRouter } from '../utils/router.js';
import Transaction from '../models/Transaction.js';
import BankAccount from '../models/BankAccount.js';
import Category from '../models/Category.js';
import User from '../models/User.js';
import { authMiddleware } from '../middleware/auth.js';
import {createTransactionRoute, listTransactionsRoute, deleteTransactionRoute, createTransferRoute, getStatsRoute, updateTransactionRoute, batchCreateTransactionRoute} from '../definitions/transaction.definitions.js';
import sequelize from '../config/database.js';
import { Op, fn, col } from 'sequelize';
import { logger } from '../utils/logger.js';
import { sendPushNotification } from '../services/fcmService.js';

const LOW_BALANCE_THRESHOLD = 100;

const transactions = createRouter();

transactions.use('*', authMiddleware);

transactions.openapi(listTransactionsRoute, async (c) => {
    const user = c.get('jwtPayload');
    const { limit, offset, accountId } = c.req.valid('query');

    const whereClause: any = { userId: user.id };
    if (accountId) whereClause.accountId = accountId;

    const { rows, count } = await Transaction.findAndCountAll({
        where: whereClause,
        order: [['date', 'DESC']],
        limit: Number(limit),
        offset: Number(offset)
    });

    c.header('X-Total-Count', count.toString());

    return c.json(rows, 200);
});

transactions.openapi(createTransactionRoute, async (c) => {
    const user = c.get('jwtPayload');
    const body = c.req.valid('json');
    const t = await sequelize.transaction();

    try {
        const [transaction, created] = await Transaction.findOrCreate({
            where: { id: body.id },
            defaults: {
                ...body,
                userId: user.id,
                date: body.date ? new Date(body.date) : new Date()
            },
            transaction: t
        });

        if (!created) {
            await t.rollback();
            return c.json(transaction, 200);
        }

        // Mise à jour automatique du solde du compte
        const account = await BankAccount.findOne({ where: { id: body.accountId, userId: user.id }, transaction: t });
        if (!account) {
            await t.rollback();
            return c.json({ error: "Compte introuvable" }, 404);
        }

        // Amount is always signed by the client (expense = negative, income = positive,
        // transfer source = negative, transfer target = positive)
        const adjustment = Number(body.amount);
        account.balance = Number(account.balance) + adjustment;
        await account.save({ transaction: t });

        await t.commit();

        // Notification solde bas (dépenses uniquement)
        if (body.type === 'expense' && Number(account.balance) < LOW_BALANCE_THRESHOLD) {
            User.findByPk(user.id).then((dbUser) => {
                if (dbUser?.fcmToken && dbUser.notificationPrefs?.lowBalance !== false) {
                    sendPushNotification(
                        dbUser.fcmToken,
                        'Solde bas',
                        `Votre solde est de ${Number(account.balance).toFixed(2)} €. Pensez à alimenter votre compte.`
                    );
                }
            }).catch(() => {});
        }

        return c.json(transaction, 201);
    } catch (error) {
        await t.rollback();
        logger.error(error);
        return c.json({ error: 'Une erreur interne est survenue' }, 500);
    }
});

transactions.openapi(deleteTransactionRoute, async (c) => {
    const user = c.get('jwtPayload');
    const { id } = c.req.valid('param');
    const t = await sequelize.transaction();

    try {
        const transaction = await Transaction.findOne({
            where: { id, userId: user.id },
            transaction: t
        });

        if (!transaction) {
            await t.rollback();
            return c.json({ error: "Transaction introuvable" }, 404);
        }

        const account = await BankAccount.findByPk(transaction.accountId, { transaction: t });

        if (account) {
            account.balance = Number(account.balance) - Number(transaction.amount);
            await account.save({ transaction: t });
        }

        // For transfers, also delete the paired transaction and reverse its balance
        if (transaction.type === 'transfer') {
            const paired = await Transaction.findOne({
                where: {
                    userId: user.id,
                    type: 'transfer',
                    date: transaction.date,
                    id: { [Op.ne]: transaction.id }
                },
                transaction: t
            });
            if (paired) {
                const pairedAccount = await BankAccount.findByPk(paired.accountId, { transaction: t });
                if (pairedAccount) {
                    pairedAccount.balance = Number(pairedAccount.balance) - Number(paired.amount);
                    await pairedAccount.save({ transaction: t });
                }
                await paired.destroy({ transaction: t });
            }
        }

        await transaction.destroy({ transaction: t });

        await t.commit();
        return c.json({ success: true }, 200);

    } catch (error) {
        if (t) await t.rollback();
        logger.error(error);
        return c.json({ error: 'Une erreur interne est survenue' }, 500);
    }
});

transactions.openapi(createTransferRoute, async (c) => {
    const user = c.get('jwtPayload');
    const body = c.req.valid('json');
    const t = await sequelize.transaction();

    try {
        const [fromAccount, toAccount] = await Promise.all([
            BankAccount.findOne({ where: { id: body.fromAccountId, userId: user.id }, transaction: t }),
            BankAccount.findOne({ where: { id: body.toAccountId, userId: user.id }, transaction: t })
        ]);

        if (!fromAccount || !toAccount) {
            await t.rollback();
            return c.json({ error: "Un ou plusieurs comptes sont introuvables" }, 404);
        }

        const amount = Number(body.amount);
        const date = body.date || new Date();
        const note = body.note || `Transfert de ${fromAccount.name} vers ${toAccount.name}`;

        const fromTransaction = await Transaction.create({
            userId: user.id,
            accountId: fromAccount.id,
            amount: amount,
            type: 'transfer',
            date: date,
            note: note,
            categoryId: body.categoryId,
            isChecked: true
        }, { transaction: t });

        const toTransaction = await Transaction.create({
            userId: user.id,
            accountId: toAccount.id,
            amount: amount,
            type: 'transfer',
            date: date,
            note: note,
            categoryId: body.categoryId,
            isChecked: true
        }, { transaction: t });

        fromAccount.balance = Number(fromAccount.balance) - amount;
        toAccount.balance = Number(toAccount.balance) + amount;

        await Promise.all([
            fromAccount.save({ transaction: t }),
            toAccount.save({ transaction: t })
        ]);

        await t.commit();

        return c.json({ fromTransaction, toTransaction }, 201);

    } catch (error) {
        if (t) await t.rollback();
        logger.error(error);
        return c.json({ error: 'Une erreur interne est survenue' }, 500);
    }
});

transactions.openapi(getStatsRoute, async (c) => {
    const user = c.get('jwtPayload');
    const { startDate, endDate, accountId } = c.req.valid('query');

    const start = startDate ? new Date(startDate) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const end = endDate ? new Date(endDate) : new Date();

    const whereClause: any = {
        userId: user.id,
        date: { [Op.between]: [start, end] },
        type: { [Op.ne]: 'transfer' }
    };

    if (accountId) whereClause.accountId = accountId;

    const totals = await Transaction.findAll({
        where: whereClause,
        attributes: [
            'type',
            [fn('sum', col('amount')), 'total']
        ],
        group: ['type']
    });

    let totalIncome = 0;
    let totalExpense = 0;

    totals.forEach((t: any) => {
        const val = Number(t.get('total'));
        if (t.type === 'income') totalIncome = val;
        if (t.type === 'expense') totalExpense = val;
    });

    // 2. Répartition par catégorie (Dépenses uniquement)
    const categoryStats = await Transaction.findAll({
        where: { ...whereClause, type: 'expense' },
        include: [{
            model: Category,
            as: 'category',
            attributes: ['name', 'iconCode', 'colorValue']
        }],
        attributes: [
            'categoryId',
            [fn('sum', col('amount')), 'total'],
            [fn('count', col('Transaction.id')), 'count']
        ],
        group: ['categoryId', 'category.id'],
        order: [[fn('sum', col('amount')), 'DESC']]
    });

    const byCategory = categoryStats.map((s: any) => ({
        categoryId: s.categoryId,
        categoryName: s.category?.name || 'Sans catégorie',
        iconCode: s.category?.iconCode || null,
        colorValue: s.category?.colorValue || null,
        total: Number(s.get('total')),
        count: Number(s.get('count'))
    }));

    return c.json({
        totalIncome,
        totalExpense,
        netChange: totalIncome - totalExpense,
        byCategory
    }, 200);
});

transactions.openapi(batchCreateTransactionRoute, async (c) => {
    const user = c.get('jwtPayload');
    const { transactions: items } = c.req.valid('json');
    const t = await sequelize.transaction();

    try {
        // Skip already-existing IDs (idempotence)
        const existing = await Transaction.findAll({
            where: { id: { [Op.in]: items.map(i => i.id) }, userId: user.id },
            attributes: ['id'],
            transaction: t
        });
        const existingIds = new Set(existing.map(tx => tx.id));
        const newItems = items.filter(i => !existingIds.has(i.id));

        if (newItems.length === 0) {
            await t.rollback();
            return c.json({ imported: 0 }, 201);
        }

        // Verify all target accounts belong to the user
        const accountIds = [...new Set(newItems.map(i => i.accountId))];
        const accounts = await BankAccount.findAll({
            where: { id: { [Op.in]: accountIds }, userId: user.id },
            transaction: t
        });
        if (accounts.length !== accountIds.length) {
            await t.rollback();
            return c.json({ error: 'Un ou plusieurs comptes introuvables' }, 404);
        }

        // Bulk insert
        await Transaction.bulkCreate(
            newItems.map(item => ({
                ...item,
                userId: user.id,
                date: item.date ? new Date(item.date as unknown as string) : new Date(),
            })),
            { transaction: t }
        );

        // Update account balances (one save per account)
        const balanceDelta: Record<string, number> = {};
        for (const item of newItems) {
            balanceDelta[item.accountId] = (balanceDelta[item.accountId] ?? 0) + Number(item.amount);
        }
        const accountMap = Object.fromEntries(accounts.map(a => [a.id, a]));
        for (const [accountId, delta] of Object.entries(balanceDelta)) {
            const account = accountMap[accountId];
            account.balance = Number(account.balance) + delta;
            await account.save({ transaction: t });
        }

        await t.commit();
        return c.json({ imported: newItems.length }, 201);
    } catch (error) {
        await t.rollback();
        logger.error(error);
        return c.json({ error: 'Erreur interne' }, 500);
    }
});

transactions.openapi(updateTransactionRoute, async (c) => {
    const user = c.get('jwtPayload');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const t = await sequelize.transaction();

    try {
        const transaction = await Transaction.findOne({
            where: { id, userId: user.id },
            transaction: t
        });

        if (!transaction) {
            await t.rollback();
            return c.json({ error: "Transaction introuvable" }, 404);
        }

        const account = await BankAccount.findByPk(transaction.accountId, { transaction: t });
        if (!account) {
            await t.rollback();
            return c.json({ error: "Compte bancaire associé introuvable" }, 404);
        }

        const oldAmount = Number(transaction.amount);
        account.balance = Number(account.balance) - oldAmount;

        await transaction.update(body, { transaction: t });

        const newAmount = Number(transaction.amount);
        account.balance = Number(account.balance) + newAmount;

        await account.save({ transaction: t });
        await t.commit();

        return c.json(transaction, 200);

    } catch (error) {
        if (t) await t.rollback();
        logger.error(error);
        return c.json({ error: 'Une erreur interne est survenue' }, 500);
    }
});

export default transactions;