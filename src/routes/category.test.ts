import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../types.js';

vi.mock('../middleware/auth.js', () => ({
    authMiddleware: async (c: any, next: any) => {
        c.set('jwtPayload', { id: 'user-123', email: 'test@test.com', exp: 9999999999 });
        await next();
    },
}));

vi.mock('../models/Category.js', () => ({
    default: {
        findAll: vi.fn(),
        create: vi.fn(),
        findOne: vi.fn(),
        destroy: vi.fn(),
    },
}));

vi.mock('../utils/logger.js', () => ({
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import Category from '../models/Category.js';
import categoryRoutes from './category.js';

const app = new OpenAPIHono<AppEnv>();
app.route('/', categoryRoutes);

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

const makeCategory = (data: Record<string, any>) => ({
    ...data,
    update: vi.fn().mockImplementation(function (this: any, d: any) {
        Object.assign(this, d);
        return Promise.resolve();
    }),
});

describe('GET / — lister les catégories', () => {
    beforeEach(() => vi.clearAllMocks());

    it('retourne 200 avec la liste des catégories', async () => {
        vi.mocked(Category.findAll).mockResolvedValue([
            makeCategory({ id: VALID_UUID, name: 'Alimentation', iconCode: 'restaurant', colorValue: 4294901760, parentId: null, userId: 'user-123' }) as any,
        ]);

        const res = await app.request('/');
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(Array.isArray(data)).toBe(true);
        expect(data[0].id).toBe(VALID_UUID);
    });

    it('retourne un tableau vide si aucune catégorie', async () => {
        vi.mocked(Category.findAll).mockResolvedValue([]);
        const res = await app.request('/');
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual([]);
    });
});

describe('POST / — créer une catégorie', () => {
    beforeEach(() => vi.clearAllMocks());

    it('crée une nouvelle catégorie et retourne 201', async () => {
        const newCategory = makeCategory({ id: VALID_UUID, name: 'Alimentation', iconCode: 'restaurant', colorValue: 4294901760, parentId: null, userId: 'user-123' });
        vi.mocked(Category.create).mockResolvedValue(newCategory as any);

        const res = await app.request('/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: VALID_UUID, name: 'Alimentation', iconCode: 'restaurant', colorValue: 4294901760 }),
        });

        expect(res.status).toBe(201);
    });

    it('crée une catégorie avec parentId optionnel', async () => {
        const PARENT_UUID = '550e8400-e29b-41d4-a716-446655440001';
        const newCategory = makeCategory({ id: VALID_UUID, name: 'Sous-catégorie', iconCode: 'star', colorValue: 123, parentId: PARENT_UUID, userId: 'user-123' });
        vi.mocked(Category.create).mockResolvedValue(newCategory as any);

        const res = await app.request('/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: VALID_UUID, name: 'Sous-catégorie', iconCode: 'star', colorValue: 123, parentId: PARENT_UUID }),
        });

        expect(res.status).toBe(201);
    });

    it('retourne 400 si name est manquant', async () => {
        const res = await app.request('/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: VALID_UUID, iconCode: 'restaurant', colorValue: 4294901760 }),
        });
        expect(res.status).toBe(400);
    });

    it('retourne 400 si id est manquant', async () => {
        const res = await app.request('/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Alimentation', iconCode: 'restaurant', colorValue: 4294901760 }),
        });
        expect(res.status).toBe(400);
    });

    it('retourne 500 si une erreur interne survient', async () => {
        vi.mocked(Category.create).mockRejectedValue(new Error('DB error'));

        const res = await app.request('/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: VALID_UUID, name: 'Alimentation', iconCode: 'restaurant', colorValue: 4294901760 }),
        });

        expect(res.status).toBe(500);
    });
});

describe('PATCH /:id — modifier une catégorie', () => {
    beforeEach(() => vi.clearAllMocks());

    it('met à jour une catégorie et retourne 200', async () => {
        const mockCat = makeCategory({ id: VALID_UUID, name: 'Alimentation', iconCode: 'restaurant', colorValue: 4294901760, parentId: null, userId: 'user-123' });
        vi.mocked(Category.findOne).mockResolvedValue(mockCat as any);

        const res = await app.request(`/${VALID_UUID}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Nourriture' }),
        });

        expect(res.status).toBe(200);
        expect(mockCat.update).toHaveBeenCalledWith({ name: 'Nourriture' });
    });

    it('met à jour plusieurs champs simultanément', async () => {
        const mockCat = makeCategory({ id: VALID_UUID, name: 'Alimentation', iconCode: 'restaurant', colorValue: 4294901760, parentId: null, userId: 'user-123' });
        vi.mocked(Category.findOne).mockResolvedValue(mockCat as any);

        const res = await app.request(`/${VALID_UUID}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Transport', iconCode: 'car' }),
        });

        expect(res.status).toBe(200);
        expect(mockCat.update).toHaveBeenCalledWith({ name: 'Transport', iconCode: 'car' });
    });

    it("retourne 404 si la catégorie n'existe pas", async () => {
        vi.mocked(Category.findOne).mockResolvedValue(null);

        const res = await app.request(`/${VALID_UUID}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Test' }),
        });

        expect(res.status).toBe(404);
    });
});

describe('DELETE /:id — supprimer une catégorie', () => {
    beforeEach(() => vi.clearAllMocks());

    it('supprime une catégorie et retourne 200', async () => {
        vi.mocked(Category.destroy).mockResolvedValue(1);

        const res = await app.request(`/${VALID_UUID}`, { method: 'DELETE' });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
    });

    it("retourne 404 si la catégorie n'existe pas", async () => {
        vi.mocked(Category.destroy).mockResolvedValue(0);

        const res = await app.request(`/${VALID_UUID}`, { method: 'DELETE' });
        expect(res.status).toBe(404);
    });

    it('transmet userId pour éviter la suppression cross-user', async () => {
        vi.mocked(Category.destroy).mockResolvedValue(1);

        await app.request(`/${VALID_UUID}`, { method: 'DELETE' });

        expect(Category.destroy).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ userId: 'user-123' }) })
        );
    });
});
