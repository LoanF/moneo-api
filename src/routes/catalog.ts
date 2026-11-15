import { createRoute, z } from '@hono/zod-openapi';
import { BankAccount, Category, Chequebook, PaymentMethod, sequelize } from '../db/models.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { publish } from '../lib/events.js';
import { IdParam, SuccessSchema, body, createRouter, errors, json, secured } from '../lib/http.js';
import { authMiddleware } from '../middleware/auth.js';

// ── Catégories ───────────────────────────────────────────────────────────────

export const CategorySchema = z
    .object({
        id: z.uuid(),
        name: z.string(),
        iconCode: z.string(),
        colorValue: z.number(),
        parentId: z.uuid().nullable(),
        sortOrder: z.number(),
    })
    .openapi('Category');

const CategoryInput = z.object({
    name: z.string().trim().min(1, 'Le nom est requis').max(80),
    iconCode: z.string().max(60).default('category'),
    colorValue: z.number().int().nonnegative().default(0xff607d8b),
    parentId: z.uuid().nullish(),
});

export const serializeCategory = (c: Category) => ({
    id: c.id,
    name: c.name,
    iconCode: c.iconCode,
    colorValue: c.colorValue,
    parentId: c.parentId,
    sortOrder: c.sortOrder,
});

export const listCategories = async (userId: string) =>
    (await Category.findAll({ where: { userId }, order: [['sortOrder', 'ASC'], ['name', 'ASC']] })).map(serializeCategory);

/** Deux niveaux seulement, comme le classeur : libellé principal → libellé secondaire. */
const assertValidParent = async (userId: string, parentId: string | null | undefined, selfId?: string) => {
    if (!parentId) return;
    if (parentId === selfId) throw badRequest('Une catégorie ne peut pas être sa propre parente');
    const parent = await Category.findOne({ where: { id: parentId, userId } });
    if (!parent) throw notFound('Catégorie parente introuvable');
    if (parent.parentId) throw badRequest('Une sous-catégorie ne peut pas contenir d’autres catégories');
    if (selfId && (await Category.count({ where: { parentId: selfId, userId } })) > 0) {
        throw badRequest('Cette catégorie contient des sous-catégories et ne peut pas être déplacée');
    }
};

export const categories = createRouter();
categories.use('*', authMiddleware);

categories.openapi(
    createRoute({ method: 'get', path: '/', tags: ['Catégories'], summary: 'Lister les catégories', security: secured, responses: { 200: json(CategorySchema.array()), ...errors } }),
    async (c) => c.json(await listCategories(c.get('auth').userId), 200),
);

categories.openapi(
    createRoute({
        method: 'post',
        path: '/',
        tags: ['Catégories'],
        summary: 'Créer une catégorie ou une sous-catégorie',
        security: secured,
        request: body(CategoryInput.extend({ id: z.uuid().optional() }).openapi('CreateCategoryInput')),
        responses: { 201: json(CategorySchema, 'Créée'), 200: json(CategorySchema, 'Déjà créée (rejeu)'), ...errors },
    }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        const input = c.req.valid('json');
        if (input.id) {
            const existing = await Category.findByPk(input.id);
            if (existing) {
                if (existing.userId !== userId) throw conflict('Identifiant déjà utilisé');
                return c.json(serializeCategory(existing), 200);
            }
        }
        await assertValidParent(userId, input.parentId);
        const last = ((await Category.max('sortOrder', { where: { userId, parentId: input.parentId ?? null } })) as number | null) ?? -1;
        const category = await Category.create({ ...input, parentId: input.parentId ?? null, userId, sortOrder: last + 1 });
        publish(userId, { model: 'category', type: 'created', id: category.id, origin: sessionId });
        return c.json(serializeCategory(category), 201);
    },
);

categories.openapi(
    createRoute({
        method: 'put',
        path: '/order',
        tags: ['Catégories'],
        summary: 'Réordonner des catégories de même niveau',
        security: secured,
        request: body(z.object({ ids: z.uuid().array().min(1).max(500) })),
        responses: { 200: json(CategorySchema.array()), ...errors },
    }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        const { ids } = c.req.valid('json');
        await sequelize.transaction(async (transaction) => {
            await Promise.all(ids.map((id, index) => Category.update({ sortOrder: index }, { where: { id, userId }, transaction })));
        });
        publish(userId, { model: 'category', type: 'bulk', origin: sessionId });
        return c.json(await listCategories(userId), 200);
    },
);

categories.openapi(
    createRoute({
        method: 'patch',
        path: '/{id}',
        tags: ['Catégories'],
        summary: 'Modifier une catégorie',
        security: secured,
        request: { params: IdParam, ...body(CategoryInput.partial().openapi('UpdateCategoryInput')) },
        responses: { 200: json(CategorySchema), ...errors },
    }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        const { id } = c.req.valid('param');
        const patch = c.req.valid('json');
        const category = await Category.findOne({ where: { id, userId } });
        if (!category) throw notFound('Catégorie introuvable');
        if (patch.parentId !== undefined) await assertValidParent(userId, patch.parentId, id);
        category.set({ ...patch, ...(patch.parentId !== undefined ? { parentId: patch.parentId ?? null } : {}) });
        await category.save();
        publish(userId, { model: 'category', type: 'updated', id, origin: sessionId });
        return c.json(serializeCategory(category), 200);
    },
);

categories.openapi(
    createRoute({
        method: 'delete',
        path: '/{id}',
        tags: ['Catégories'],
        summary: 'Supprimer une catégorie et ses sous-catégories (les opérations sont conservées, sans catégorie)',
        security: secured,
        request: { params: IdParam },
        responses: { 200: json(SuccessSchema), ...errors },
    }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        const { id } = c.req.valid('param');
        if (!(await Category.destroy({ where: { id, userId } }))) throw notFound('Catégorie introuvable');
        publish(userId, { model: 'category', type: 'deleted', id, origin: sessionId });
        return c.json({ success: true }, 200);
    },
);

// ── Moyens de paiement ───────────────────────────────────────────────────────

const Kind = z.enum(['card', 'cheque', 'direct_debit', 'transfer', 'cash', 'other']);
const Direction = z.enum(['income', 'expense']);

export const PaymentMethodSchema = z
    .object({ id: z.uuid(), name: z.string(), kind: Kind, defaultDirection: Direction, sortOrder: z.number() })
    .openapi('PaymentMethod');

const PaymentMethodInput = z.object({
    name: z.string().trim().min(1, 'Le nom est requis').max(80),
    kind: Kind.default('card'),
    defaultDirection: Direction.default('expense'),
});

export const serializePaymentMethod = (m: PaymentMethod) => ({
    id: m.id,
    name: m.name,
    kind: m.kind,
    defaultDirection: m.defaultDirection,
    sortOrder: m.sortOrder,
});

export const listPaymentMethods = async (userId: string) =>
    (await PaymentMethod.findAll({ where: { userId }, order: [['sortOrder', 'ASC'], ['name', 'ASC']] })).map(serializePaymentMethod);

export const paymentMethods = createRouter();
paymentMethods.use('*', authMiddleware);

paymentMethods.openapi(
    createRoute({ method: 'get', path: '/', tags: ['Moyens de paiement'], summary: 'Lister les moyens de paiement', security: secured, responses: { 200: json(PaymentMethodSchema.array()), ...errors } }),
    async (c) => c.json(await listPaymentMethods(c.get('auth').userId), 200),
);

paymentMethods.openapi(
    createRoute({
        method: 'post',
        path: '/',
        tags: ['Moyens de paiement'],
        summary: 'Créer un moyen de paiement',
        security: secured,
        request: body(PaymentMethodInput.extend({ id: z.uuid().optional() }).openapi('CreatePaymentMethodInput')),
        responses: { 201: json(PaymentMethodSchema, 'Créé'), 200: json(PaymentMethodSchema, 'Déjà créé (rejeu)'), ...errors },
    }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        const input = c.req.valid('json');
        if (input.id) {
            const existing = await PaymentMethod.findByPk(input.id);
            if (existing) {
                if (existing.userId !== userId) throw conflict('Identifiant déjà utilisé');
                return c.json(serializePaymentMethod(existing), 200);
            }
        }
        const last = ((await PaymentMethod.max('sortOrder', { where: { userId } })) as number | null) ?? -1;
        const method = await PaymentMethod.create({ ...input, userId, sortOrder: last + 1 });
        publish(userId, { model: 'paymentMethod', type: 'created', id: method.id, origin: sessionId });
        return c.json(serializePaymentMethod(method), 201);
    },
);

paymentMethods.openapi(
    createRoute({
        method: 'patch',
        path: '/{id}',
        tags: ['Moyens de paiement'],
        summary: 'Modifier un moyen de paiement',
        security: secured,
        request: { params: IdParam, ...body(PaymentMethodInput.partial().openapi('UpdatePaymentMethodInput')) },
        responses: { 200: json(PaymentMethodSchema), ...errors },
    }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        const { id } = c.req.valid('param');
        const method = await PaymentMethod.findOne({ where: { id, userId } });
        if (!method) throw notFound('Moyen de paiement introuvable');
        await method.update(c.req.valid('json'));
        publish(userId, { model: 'paymentMethod', type: 'updated', id, origin: sessionId });
        return c.json(serializePaymentMethod(method), 200);
    },
);

paymentMethods.openapi(
    createRoute({ method: 'delete', path: '/{id}', tags: ['Moyens de paiement'], summary: 'Supprimer un moyen de paiement', security: secured, request: { params: IdParam }, responses: { 200: json(SuccessSchema), ...errors } }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        const { id } = c.req.valid('param');
        if (!(await PaymentMethod.destroy({ where: { id, userId } }))) throw notFound('Moyen de paiement introuvable');
        publish(userId, { model: 'paymentMethod', type: 'deleted', id, origin: sessionId });
        return c.json({ success: true }, 200);
    },
);

// ── Chéquiers ────────────────────────────────────────────────────────────────

export const ChequebookSchema = z
    .object({
        id: z.uuid(),
        name: z.string(),
        accountId: z.uuid().nullable(),
        nextNumber: z.number().openapi({ description: 'Numéro attribué au prochain chèque' }),
        isActive: z.boolean(),
    })
    .openapi('Chequebook');

const ChequebookInput = z.object({
    name: z.string().trim().min(1, 'Le nom est requis').max(80),
    accountId: z.uuid().nullish(),
    nextNumber: z.number().int().min(1).max(2_000_000_000).default(1),
    isActive: z.boolean().default(true),
});

export const serializeChequebook = (b: Chequebook) => ({
    id: b.id,
    name: b.name,
    accountId: b.accountId,
    nextNumber: b.nextNumber,
    isActive: b.isActive,
});

export const listChequebooks = async (userId: string) =>
    (await Chequebook.findAll({ where: { userId }, order: [['createdAt', 'ASC']] })).map(serializeChequebook);

const assertAccount = async (userId: string, accountId: string | null | undefined) => {
    if (accountId && !(await BankAccount.findOne({ where: { id: accountId, userId } }))) throw notFound('Compte introuvable');
};

export const chequebooks = createRouter();
chequebooks.use('*', authMiddleware);

chequebooks.openapi(
    createRoute({ method: 'get', path: '/', tags: ['Chéquiers'], summary: 'Lister les chéquiers', security: secured, responses: { 200: json(ChequebookSchema.array()), ...errors } }),
    async (c) => c.json(await listChequebooks(c.get('auth').userId), 200),
);

chequebooks.openapi(
    createRoute({
        method: 'post',
        path: '/',
        tags: ['Chéquiers'],
        summary: 'Entamer un nouveau chéquier',
        security: secured,
        request: body(ChequebookInput.extend({ id: z.uuid().optional() }).openapi('CreateChequebookInput')),
        responses: { 201: json(ChequebookSchema, 'Créé'), 200: json(ChequebookSchema, 'Déjà créé (rejeu)'), ...errors },
    }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        const input = c.req.valid('json');
        if (input.id) {
            const existing = await Chequebook.findByPk(input.id);
            if (existing) {
                if (existing.userId !== userId) throw conflict('Identifiant déjà utilisé');
                return c.json(serializeChequebook(existing), 200);
            }
        }
        await assertAccount(userId, input.accountId);
        const book = await Chequebook.create({ ...input, accountId: input.accountId ?? null, userId });
        publish(userId, { model: 'chequebook', type: 'created', id: book.id, origin: sessionId });
        return c.json(serializeChequebook(book), 201);
    },
);

chequebooks.openapi(
    createRoute({
        method: 'patch',
        path: '/{id}',
        tags: ['Chéquiers'],
        summary: 'Modifier un chéquier (changement de carnet, correction du numéro)',
        security: secured,
        request: { params: IdParam, ...body(ChequebookInput.partial().openapi('UpdateChequebookInput')) },
        responses: { 200: json(ChequebookSchema), ...errors },
    }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        const { id } = c.req.valid('param');
        const patch = c.req.valid('json');
        const book = await Chequebook.findOne({ where: { id, userId } });
        if (!book) throw notFound('Chéquier introuvable');
        await assertAccount(userId, patch.accountId);
        await book.update({ ...patch, ...(patch.accountId !== undefined ? { accountId: patch.accountId ?? null } : {}) });
        publish(userId, { model: 'chequebook', type: 'updated', id, origin: sessionId });
        return c.json(serializeChequebook(book), 200);
    },
);

chequebooks.openapi(
    createRoute({ method: 'delete', path: '/{id}', tags: ['Chéquiers'], summary: 'Supprimer un chéquier', security: secured, request: { params: IdParam }, responses: { 200: json(SuccessSchema), ...errors } }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        const { id } = c.req.valid('param');
        if (!(await Chequebook.destroy({ where: { id, userId } }))) throw notFound('Chéquier introuvable');
        publish(userId, { model: 'chequebook', type: 'deleted', id, origin: sessionId });
        return c.json({ success: true }, 200);
    },
);
