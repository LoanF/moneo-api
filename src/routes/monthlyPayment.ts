import { OpenAPIHono } from '@hono/zod-openapi';
import MonthlyPayment from '../models/MonthlyPayment.js';
import { authMiddleware } from '../middleware/auth.js';
import { createMonthlyPaymentRoute, listMonthlyPaymentsRoute } from '../definitions/monthlyPayment.definitions.js';

const monthlyPayments = new OpenAPIHono();

monthlyPayments.use('*', authMiddleware);

monthlyPayments.openapi(listMonthlyPaymentsRoute, async (c) => {
    const user = c.get('jwtPayload');
    const list = await MonthlyPayment.findAll({ where: { userId: user.id } });
    return c.json(list, 200);
});

monthlyPayments.openapi(createMonthlyPaymentRoute, async (c) => {
    const user = c.get('jwtPayload');
    const body = c.req.valid('json');

    try {
        const payment = await MonthlyPayment.create({
            ...body,
            userId: Number(user.id)
        });

        return c.json(payment, 201);
    } catch (error: any) {
        return c.json({ error: error.message }, 400);
    }
});

export default monthlyPayments;