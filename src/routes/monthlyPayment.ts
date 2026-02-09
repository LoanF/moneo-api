import { OpenAPIHono } from '@hono/zod-openapi';
import MonthlyPayment from '../models/MonthlyPayment.js';
import { authMiddleware } from '../middleware/auth.js';
import {createMonthlyPaymentRoute, deleteMonthlyPaymentRoute, listMonthlyPaymentsRoute, updateMonthlyPaymentRoute} from '../definitions/monthlyPayment.definitions.js';

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
        const [payment, created] = await MonthlyPayment.findOrCreate({
            where: { id: body.id },
            defaults: { ...body, userId: user.id }
        });

        return c.json(payment, created ? 201 : 200);
    } catch (error: any) {
        return c.json({ error: error.message }, 400);
    }
});

monthlyPayments.openapi(updateMonthlyPaymentRoute, async (c) => {
    const user = c.get('jwtPayload');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const payment = await MonthlyPayment.findOne({ where: { id, userId: user.id } });
    if (!payment) return c.json({ error: "Paiement mensuel introuvable" }, 404);

    await payment.update(body);
    return c.json(payment, 200);
});

monthlyPayments.openapi(deleteMonthlyPaymentRoute, async (c) => {
    const user = c.get('jwtPayload');
    const { id } = c.req.valid('param');

    const deleted = await MonthlyPayment.destroy({ where: { id, userId: user.id } });
    if (!deleted) return c.json({ error: "Paiement mensuel introuvable" }, 404);

    return c.json({ success: true }, 200);
});

export default monthlyPayments;