import { OpenAPIHono } from '@hono/zod-openapi';
import Category from '../models/Category.js';
import { authMiddleware } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';
import {createCategoryRoute, deleteCategoryRoute, listCategoriesRoute, updateCategoryRoute} from '../definitions/category.definitions.js';
import { logger } from '../utils/logger.js';

const categories = new OpenAPIHono<AppEnv>();

categories.use('*', authMiddleware);

categories.openapi(listCategoriesRoute, async (c) => {
    const user = c.get('jwtPayload');
    const list = await Category.findAll({ where: { userId: user.id } });
    return c.json(list, 200);
});

categories.openapi(createCategoryRoute, async (c) => {
    const user = c.get('jwtPayload');
    const body = c.req.valid('json');

    try {
        const category = await Category.create({
            ...body,
            userId: user.id
        });
        return c.json(category, 201);
    } catch (error) {
        logger.error(error);
        return c.json({ error: 'Une erreur interne est survenue' }, 500);
    }
});

categories.openapi(updateCategoryRoute, async (c) => {
    const user = c.get('jwtPayload');
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    const category = await Category.findOne({ where: { id, userId: user.id } });
    if (!category) return c.json({ error: "Catégorie introuvable" }, 404);

    await category.update(body);
    return c.json(category, 200);
});

categories.openapi(deleteCategoryRoute, async (c) => {
    const user = c.get('jwtPayload');
    const { id } = c.req.valid('param');

    const deleted = await Category.destroy({ where: { id, userId: user.id } });
    if (!deleted) return c.json({ error: "Catégorie introuvable" }, 404);

    return c.json({ success: true }, 200);
});

export default categories;