import { OpenAPIHono } from '@hono/zod-openapi';
import BankAccount from '../models/BankAccount.js';
import { authMiddleware } from '../middleware/auth.js';
import {createBankAccountRoute, deleteBankAccountRoute, listBankAccountsRoute, updateBankAccountRoute} from "../definitions/bankAccount.definitions.js";
import Transaction from '../models/Transaction.js';
import MonthlyPayment from "../models/MonthlyPayment.js";
import sequelize from "../config/database.js";

const accounts = new OpenAPIHono();

accounts.use('*', authMiddleware);

accounts.openapi(listBankAccountsRoute, async (c) => {
    const user = c.get('jwtPayload');
    const list = await BankAccount.findAll({ where: { userId: user.id } });
    return c.json(list, 200);
});

accounts.openapi(createBankAccountRoute, async (c) => {
    const user = c.get('jwtPayload');
    const body = c.req.valid('json');

    try {
        const account = await BankAccount.create({
            ...body,
            userId: user.id
        });
        return c.json(account, 201);
    } catch (error: any) {
        return c.json({ error: error.message }, 400);
    }
});

accounts.openapi(updateBankAccountRoute, async (c) => {
    const user = c.get('jwtPayload');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    try {
        const account = await BankAccount.findOne({
            where: { id: Number(id), userId: user.id }
        });

        if (!account) {
            return c.json({ error: "Compte bancaire introuvable ou accès refusé" }, 404);
        }

        await account.update(body);

        return c.json(account, 200);

    } catch (error: any) {
        return c.json({ error: error.message || "Erreur lors de la mise à jour" }, 400);
    }
});

accounts.openapi(deleteBankAccountRoute, async (c) => {
    const user = c.get('jwtPayload');
    const { id } = c.req.valid('param');
    const t = await sequelize.transaction();

    try {
        const account = await BankAccount.findOne({
            where: { id: Number(id), userId: user.id },
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

    } catch (error: any) {
        if (t) await t.rollback();
        return c.json({ error: error.message || "Erreur lors de la suppression en cascade" }, 400);
    }
});

export default accounts;