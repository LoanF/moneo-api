import { OpenAPIHono } from '@hono/zod-openapi';
import Category from '../models/Category.js';
import { authMiddleware } from '../middleware/auth.js';
import { createCategoryRoute, listCategoriesRoute } from './category.definitions.js';

const categories = new OpenAPIHono();

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
    } catch (error: any) {
        return c.json({ error: error.message }, 400);
    }
});

export default categories;