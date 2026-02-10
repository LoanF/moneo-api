import {createRoute, z} from '@hono/zod-openapi';
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

export const updateCategorySchema = CreateCategorySchema.partial();

export const updateCategoryRoute = createRoute({
    method: 'patch',
    path: '/{id}',
    summary: 'Modifier une catégorie',
    tags: ['Catégories'],
    security: [{ Bearer: [] }],
    request: {
        params: z.object({ id: z.string() }),
        body: { content: { 'application/json': { schema: updateCategorySchema } } }
    },
    responses: {
        200: { content: { 'application/json': { schema: CategoryResponseSchema } }, description: 'Modifié' },
        404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Non trouvé' }
    }
});

export const deleteCategoryRoute = createRoute({
    method: 'delete',
    path: '/{id}',
    summary: 'Supprimer une catégorie',
    tags: ['Catégories'],
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.boolean() }) } }, description: 'Supprimé' },
        404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Non trouvé' }
    }
});