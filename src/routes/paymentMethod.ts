import { OpenAPIHono } from '@hono/zod-openapi';
import PaymentMethod from '../models/PaymentMethod.js';
import { authMiddleware } from '../middleware/auth.js';
import { createPaymentMethodRoute, listPaymentMethodsRoute } from './paymentMethod.definitions.js';

const paymentMethods = new OpenAPIHono();

paymentMethods.use('*', authMiddleware);

paymentMethods.openapi(listPaymentMethodsRoute, async (c) => {
    const user = c.get('jwtPayload');
    const list = (await PaymentMethod.findAll({where: {userId: user.id}}));
    return c.json(list, 200);
});

paymentMethods.openapi(createPaymentMethodRoute, async (c) => {
    const user = c.get('jwtPayload');
    const body = c.req.valid('json');

    try {
        const paymentMethod = await PaymentMethod.create({
            ...body,
            userId: user.id
        });
        return c.json(paymentMethod, 201);
    } catch (error: any) {
        return c.json({ error: error.message }, 400);
    }
});

export default paymentMethods;