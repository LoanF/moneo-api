import BankAccount from '../models/BankAccount.js';
import { authMiddleware } from '../middleware/auth.js';
import { createRouter } from '../utils/router.js';
import {createBankAccountRoute, deleteBankAccountRoute, listBankAccountsRoute, updateBankAccountRoute} from "../definitions/bankAccount.definitions.js";
import Transaction from '../models/Transaction.js';
import MonthlyPayment from "../models/MonthlyPayment.js";
import sequelize from "../config/database.js";
import { fn, col } from 'sequelize';
import { logger } from '../utils/logger.js';

const accounts = createRouter();

accounts.use('*', authMiddleware);

accounts.openapi(listBankAccountsRoute, async (c) => {
    const user = c.get('jwtPayload');

    const [list, uncheckedSums] = await Promise.all([
        BankAccount.findAll({ where: { userId: user.id }, order: [['sortOrder', 'ASC'], ['createdAt', 'ASC']] }),
        Transaction.findAll({
            where: { userId: user.id, isChecked: false },
            attributes: ['accountId', [fn('sum', col('amount')), 'total']],
            group: ['accountId'],
            raw: true,
        })
    ]);

    const uncheckedByAccount: Record<string, number> = {};
    for (const row of uncheckedSums as any[]) {
        uncheckedByAccount[row.accountId] = Number(row.total) || 0;
    }

    const result = list.map(a => ({
        ...a.toJSON(),
        pointedBalance: Number(a.balance) - (uncheckedByAccount[a.id] || 0)
    }));

    return c.json(result, 200);
});

accounts.openapi(createBankAccountRoute, async (c) => {
    const user = c.get('jwtPayload');
    const body = c.req.valid('json');

    try {
        const maxSortOrder = (await BankAccount.max('sortOrder', { where: { userId: user.id } }) as number) ?? -1;

        const [account, created] = await BankAccount.findOrCreate({
            where: { id: body.id },
            defaults: {
                ...body,
                userId: user.id,
                sortOrder: maxSortOrder + 1
            }
        });

        return c.json({
            ...account.toJSON(),
            pointedBalance: Number(account.balance)
        }, created ? 201 : 200);
    } catch (error) {
        logger.error(error);
        return c.json({ error: 'Une erreur interne est survenue' }, 500);
    }
});

accounts.openapi(updateBankAccountRoute, async (c) => {
    const user = c.get('jwtPayload');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    try {
        const account = await BankAccount.findOne({
            where: { id, userId: user.id }
        });

        if (!account) {
            return c.json({ error: "Compte bancaire introuvable ou accès refusé" }, 404);
        }

        await account.update(body);

        return c.json(account, 200);

    } catch (error) {
        logger.error(error);
        return c.json({ error: 'Une erreur interne est survenue' }, 500);
    }
});

accounts.openapi(deleteBankAccountRoute, async (c) => {
    const user = c.get('jwtPayload');
    const { id } = c.req.valid('param');
    const t = await sequelize.transaction();

    try {
        const account = await BankAccount.findOne({
            where: { id, userId: user.id },
            transaction: t
        });

        if (!account) {
            await t.rollback();
            return c.json({ error: "Compte introuvable" }, 404);
        }

        await MonthlyPayment.destroy({
            where: { accountId: account.id },
            transaction: t
        });

        await Transaction.destroy({
            where: { accountId: account.id },
            transaction: t
        });

        await account.destroy({ transaction: t });
        await t.commit();

        return c.json({ success: true }, 200);

    } catch (error) {
        if (t) await t.rollback();
        logger.error(error);
        return c.json({ error: 'Une erreur interne est survenue' }, 500);
    }
});

export default accounts;