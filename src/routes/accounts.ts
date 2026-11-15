import { createRoute, z } from '@hono/zod-openapi';
import { BankAccount, sequelize } from '../db/models.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { publish } from '../lib/events.js';
import { IdParam, SuccessSchema, body, createRouter, errors, json, secured } from '../lib/http.js';
import { authMiddleware } from '../middleware/auth.js';
import { computeBalances, listAccountsWithBalances, serializeAccount } from '../services/balances.js';

const Money = z.number().finite().min(-1e12).max(1e12);

export const AccountSchema = z
    .object({
        id: z.uuid(),
        name: z.string(),
        type: z.string(),
        initialBalance: z.number(),
        currency: z.string(),
        sortOrder: z.number(),
        iconCode: z.string().nullable(),
        colorValue: z.number().nullable(),
        lowBalanceThreshold: z.number().nullable(),
        includeInTotal: z.boolean(),
        archived: z.boolean(),
        balance: z.number().openapi({ description: 'Solde restant (toutes écritures)' }),
        pointedBalance: z.number().openapi({ description: 'Solde pointé' }),
        todayBalance: z.number().openapi({ description: 'Solde à ce jour (hors écritures futures)' }),
        uncheckedCredit: z.number(),
        uncheckedDebit: z.number(),
        uncheckedCount: z.number(),
        transactionCount: z.number(),
    })
    .openapi('Account');

const AccountInput = z.object({
    name: z.string().trim().min(1, 'Le nom est requis').max(80),
    type: z.enum(['checking', 'savings', 'cash', 'investment', 'other']).default('checking'),
    initialBalance: Money.default(0),
    currency: z.string().length(3).toUpperCase().default('EUR'),
    iconCode: z.string().max(60).nullish(),
    colorValue: z.number().int().nonnegative().nullish(),
    lowBalanceThreshold: Money.nullish(),
    includeInTotal: z.boolean().default(true),
});

const accounts = createRouter();
accounts.use('*', authMiddleware);
const tags = ['Comptes'];

const one = async (userId: string, id: string) => {
    const account = await BankAccount.findOne({ where: { id, userId } });
    if (!account) throw notFound('Compte introuvable');
    return serializeAccount(account, (await computeBalances(userId)).get(id));
};

accounts.openapi(
    createRoute({ method: 'get', path: '/', tags, summary: 'Lister les comptes avec leurs soldes calculés', security: secured, responses: { 200: json(AccountSchema.array()), ...errors } }),
    async (c) => c.json(await listAccountsWithBalances(c.get('auth').userId), 200),
);

accounts.openapi(
    createRoute({
        method: 'post',
        path: '/',
        tags,
        summary: 'Créer un compte',
        security: secured,
        request: body(AccountInput.extend({ id: z.uuid().optional() }).openapi('CreateAccountInput')),
        responses: { 201: json(AccountSchema, 'Créé'), 200: json(AccountSchema, 'Déjà créé (rejeu)'), ...errors },
    }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        const input = c.req.valid('json');
        if (input.id) {
            const existing = await BankAccount.findByPk(input.id);
            if (existing) {
                if (existing.userId !== userId) throw conflict('Identifiant déjà utilisé');
                return c.json(await one(userId, existing.id), 200);
            }
        }
        const last = ((await BankAccount.max('sortOrder', { where: { userId } })) as number | null) ?? -1;
        const account = await BankAccount.create({ ...input, userId, sortOrder: last + 1 });
        publish(userId, { model: 'account', type: 'created', id: account.id, origin: sessionId });
        return c.json(await one(userId, account.id), 201);
    },
);

accounts.openapi(
    createRoute({
        method: 'put',
        path: '/order',
        tags,
        summary: 'Réordonner les comptes',
        security: secured,
        request: body(z.object({ ids: z.uuid().array().min(1).max(100) }).openapi('ReorderInput')),
        responses: { 200: json(AccountSchema.array()), ...errors },
    }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        const { ids } = c.req.valid('json');
        const owned = await BankAccount.findAll({ where: { userId } });
        if (ids.some((id) => !owned.some((a) => a.id === id))) throw badRequest('Liste de comptes invalide');
        await sequelize.transaction(async (transaction) => {
            await Promise.all(ids.map((id, index) => BankAccount.update({ sortOrder: index }, { where: { id, userId }, transaction })));
        });
        publish(userId, { model: 'account', type: 'bulk', origin: sessionId });
        return c.json(await listAccountsWithBalances(userId), 200);
    },
);

accounts.openapi(
    createRoute({
        method: 'patch',
        path: '/{id}',
        tags,
        summary: 'Modifier un compte',
        security: secured,
        request: { params: IdParam, ...body(AccountInput.partial().extend({ archived: z.boolean().optional() }).openapi('UpdateAccountInput')) },
        responses: { 200: json(AccountSchema), ...errors },
    }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        const { id } = c.req.valid('param');
        const { archived, ...patch } = c.req.valid('json');
        const account = await BankAccount.findOne({ where: { id, userId } });
        if (!account) throw notFound('Compte introuvable');

        account.set(patch);
        if (archived !== undefined) account.archivedAt = archived ? (account.archivedAt ?? new Date()) : null;
        await account.save();
        publish(userId, { model: 'account', type: 'updated', id, origin: sessionId });
        return c.json(await one(userId, id), 200);
    },
);

accounts.openapi(
    createRoute({
        method: 'delete',
        path: '/{id}',
        tags,
        summary: 'Supprimer un compte, ses opérations et ses mensualités',
        security: secured,
        request: { params: IdParam },
        responses: { 200: json(SuccessSchema), ...errors },
    }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        const { id } = c.req.valid('param');
        // Les opérations et mensualités du compte partent avec lui (ON DELETE CASCADE).
        const deleted = await BankAccount.destroy({ where: { id, userId } });
        if (!deleted) throw notFound('Compte introuvable');
        publish(userId, { model: 'account', type: 'deleted', id, origin: sessionId });
        return c.json({ success: true }, 200);
    },
);

export default accounts;
