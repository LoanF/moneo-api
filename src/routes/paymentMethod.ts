import PaymentMethod from '../models/PaymentMethod.js';
import { authMiddleware } from '../middleware/auth.js';
import { createRouter } from '../utils/router.js';
import {createPaymentMethodRoute, deletePaymentMethodRoute, listPaymentMethodsRoute, updatePaymentMethodRoute} from '../definitions/paymentMethod.definitions.js';
import { logger } from '../utils/logger.js';

const paymentMethods = createRouter();

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
        const [method, created] = await PaymentMethod.findOrCreate({
            where: { id: body.id },
            defaults: { ...body, userId: user.id }
        });
        return c.json(method, created ? 201 : 200);
    } catch (error) {
        logger.error(error);
        return c.json({ error: 'Une erreur interne est survenue' }, 500);
    }
});

paymentMethods.openapi(updatePaymentMethodRoute, async (c) => {
    const user = c.get('jwtPayload');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const method = await PaymentMethod.findOne({ where: { id, userId: user.id } });
    if (!method) return c.json({ error: "Moyen de paiement introuvable" }, 404);

    await method.update(body);
    return c.json(method, 200);
});

paymentMethods.openapi(deletePaymentMethodRoute, async (c) => {
    const user = c.get('jwtPayload');
    const { id } = c.req.valid('param');

    const deleted = await PaymentMethod.destroy({ where: { id, userId: user.id } });
    if (!deleted) return c.json({ error: "Moyen de paiement introuvable" }, 404);

    return c.json({ success: true }, 200);
});

export default paymentMethods;