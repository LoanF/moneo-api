import { createRoute } from '@hono/zod-openapi';
import { CategoryResponseSchema, CreateCategorySchema } from '../schemas/category.schema.js';
import { ErrorSchema } from '../schemas/auth.schema.js';

export const listCategoriesRoute = createRoute({
    method: 'get',
    path: '/',
    tags: ['Catégories'],
    summary: "Lister les catégories de l'utilisateur",
    security: [{ Bearer: [] }],
    responses: {
        200: { content: { 'application/json': { schema: CategoryResponseSchema.array() } }, description: 'Succès' }
    }
});

export const createCategoryRoute = createRoute({
    method: 'post',
    path: '/',
    tags: ['Catégories'],
    summary: "Créer une nouvelle catégorie",
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: CreateCategorySchema } } } },
    responses: {
        201: { content: { 'application/json': { schema: CategoryResponseSchema } }, description: 'Créé' },
        400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Erreur' }
    }
});