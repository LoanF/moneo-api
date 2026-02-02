import { OpenAPIHono } from '@hono/zod-openapi';
import Account from '../models/Account.js';
import { authMiddleware } from '../middleware/auth.js';
import {createAccountRoute, listAccountsRoute} from "./account.definitions.js";

const accounts = new OpenAPIHono();

accounts.use('*', authMiddleware);

accounts.openapi(listAccountsRoute, async (c) => {
    const user = c.get('jwtPayload'); // Récupéré via authMiddleware
    const list = await Account.findAll({ where: { userId: user.id } });
    return c.json(list, 200);
});

accounts.openapi(createAccountRoute, async (c) => {
    const user = c.get('jwtPayload');
    const body = c.req.valid('json');

    try {
        const account = await Account.create({
            ...body,
            userId: user.id
        });
        return c.json(account, 201);
    } catch (error: any) {
        return c.json({ error: error.message }, 400);
    }
});

export default accounts;