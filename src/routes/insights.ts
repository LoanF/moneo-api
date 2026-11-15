import { createRoute, z } from '@hono/zod-openapi';
import { Op, UniqueConstraintError } from 'sequelize';
import { Budget, Category, Notification, RecurringPayment } from '../db/models.js';
import { addDays, periodOf, todayISO } from '../lib/dates.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { publish } from '../lib/events.js';
import { IdParam, SuccessSchema, body, createRouter, errors, json, secured } from '../lib/http.js';
import { authMiddleware } from '../middleware/auth.js';
import { defaultStartPeriod, generateForUser, pendingForUser, serializeRecurring } from '../services/recurring.js';
import { getBalanceHistory, getBudgetsProgress, getForecast, getMonthly, getPivot, getSummary } from '../services/stats.js';
import { assertOwned } from '../services/transactions.js';

const ISODate = z.iso.date('Date invalide (AAAA-MM-JJ)');
const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Période invalide (AAAA-MM)');

/** Par défaut : du 1er du mois courant à aujourd'hui. */
const RangeQuery = z.object({ from: ISODate.optional(), to: ISODate.optional(), accountId: z.uuid().optional() });
const resolveRange = (q: z.infer<typeof RangeQuery>) => {
    const today = todayISO();
    const from = q.from ?? `${periodOf(today)}-01`;
    const to = q.to ?? today;
    if (from > to) throw badRequest('La date de début doit précéder la date de fin');
    return { from, to, accountId: q.accountId };
};

// ── Statistiques ─────────────────────────────────────────────────────────────

const Breakdown = z.object({
    categoryId: z.uuid().nullable(),
    name: z.string(),
    iconCode: z.string().nullable(),
    colorValue: z.number().nullable(),
    total: z.number(),
    count: z.number(),
    percent: z.number(),
    subcategories: z.object({ id: z.uuid(), name: z.string(), total: z.number(), count: z.number() }).array(),
});
const Point = z.object({ date: z.string(), balance: z.number() });

export const stats = createRouter();
stats.use('*', authMiddleware);
const statTags = ['Statistiques'];

stats.openapi(
    createRoute({
        method: 'get',
        path: '/summary',
        tags: statTags,
        summary: 'Synthèse d’une période : revenus, dépenses, répartition par catégorie',
        security: secured,
        request: { query: RangeQuery },
        responses: {
            200: json(
                z.object({
                    from: z.string(),
                    to: z.string(),
                    income: z.number(),
                    expense: z.number(),
                    net: z.number(),
                    savingsRate: z.number().nullable(),
                    transactionCount: z.number(),
                    averageDailyExpense: z.number(),
                    largestExpense: z.object({ id: z.uuid(), note: z.string().nullable(), amount: z.number(), date: z.string(), categoryId: z.uuid().nullable() }).nullable(),
                    expensesByCategory: Breakdown.array(),
                    incomeByCategory: Breakdown.array(),
                    expensesByPaymentMethod: z.object({ paymentMethodId: z.uuid().nullable(), name: z.string(), total: z.number(), count: z.number() }).array(),
                }).openapi('StatsSummary'),
            ),
            ...errors,
        },
    }),
    async (c) => c.json(await getSummary(c.get('auth').userId, resolveRange(c.req.valid('query'))), 200),
);

stats.openapi(
    createRoute({
        method: 'get',
        path: '/monthly',
        tags: statTags,
        summary: 'Revenus et dépenses mois par mois',
        security: secured,
        request: { query: z.object({ months: z.coerce.number().int().min(1).max(60).default(12), accountId: z.uuid().optional() }) },
        responses: { 200: json(z.object({ period: z.string(), income: z.number(), expense: z.number(), net: z.number() }).array()), ...errors },
    }),
    async (c) => {
        const { months, accountId } = c.req.valid('query');
        return c.json(await getMonthly(c.get('auth').userId, months, accountId), 200);
    },
);

stats.openapi(
    createRoute({
        method: 'get',
        path: '/balance-history',
        tags: statTags,
        summary: 'Évolution quotidienne du solde',
        security: secured,
        request: { query: RangeQuery },
        responses: { 200: json(z.object({ from: z.string(), to: z.string(), openingBalance: z.number(), points: Point.array() })), ...errors },
    }),
    async (c) => {
        const q = c.req.valid('query');
        const today = todayISO();
        const range = { from: q.from ?? addDays(today, -89), to: q.to ?? today, accountId: q.accountId };
        if (range.from > range.to) throw badRequest('La date de début doit précéder la date de fin');
        if (range.from < addDays(range.to, -3660)) throw badRequest('Période limitée à 10 ans');
        return c.json(await getBalanceHistory(c.get('auth').userId, range), 200);
    },
);

stats.openapi(
    createRoute({
        method: 'get',
        path: '/forecast',
        tags: statTags,
        summary: 'Solde prévisionnel, mensualités à venir incluses',
        security: secured,
        request: { query: z.object({ days: z.coerce.number().int().min(1).max(365).default(30), accountId: z.uuid().optional() }) },
        responses: {
            200: json(
                z.object({
                    from: z.string(),
                    to: z.string(),
                    currentBalance: z.number(),
                    projectedBalance: z.number(),
                    lowest: Point,
                    points: Point.array(),
                    upcoming: z.object({ recurringPaymentId: z.uuid(), name: z.string(), date: z.string(), amount: z.number(), accountId: z.uuid() }).array(),
                }).openapi('Forecast'),
            ),
            ...errors,
        },
    }),
    async (c) => {
        const { days, accountId } = c.req.valid('query');
        return c.json(await getForecast(c.get('auth').userId, days, accountId), 200);
    },
);

const PivotCell = z.object({ categoryId: z.uuid().nullable(), name: z.string(), debit: z.number(), credit: z.number() });

stats.openapi(
    createRoute({
        method: 'get',
        path: '/pivot',
        tags: statTags,
        summary: 'Tableau croisé période → catégorie → sous-catégorie (débits et crédits)',
        security: secured,
        request: { query: RangeQuery.extend({ granularity: z.enum(['day', 'month', 'year']).default('month') }) },
        responses: {
            200: json(
                z.object({
                    from: z.string(),
                    to: z.string(),
                    granularity: z.enum(['day', 'month', 'year']),
                    totals: z.object({ debit: z.number(), credit: z.number() }),
                    rows: z.object({
                        key: z.string(),
                        debit: z.number(),
                        credit: z.number(),
                        categories: PivotCell.extend({ subcategories: PivotCell.array() }).array(),
                    }).array(),
                }).openapi('Pivot'),
            ),
            ...errors,
        },
    }),
    async (c) => {
        const q = c.req.valid('query');
        const today = todayISO();
        const range = { from: q.from ?? `${today.slice(0, 4)}-01-01`, to: q.to ?? today, accountId: q.accountId };
        if (range.from > range.to) throw badRequest('La date de début doit précéder la date de fin');
        return c.json(await getPivot(c.get('auth').userId, range, q.granularity), 200);
    },
);

// ── Mensualités ──────────────────────────────────────────────────────────────

const MonthlyAmounts = z
    .record(z.string().regex(/^([1-9]|1[0-2])$/, 'Mois invalide (1 à 12)'), z.number().min(0).max(1e12))
    .openapi({ description: 'Exceptions par mois, ex. {"12": 85.41}. 0 = mois sauté.' });

export const RecurringSchema = z
    .object({
        id: z.uuid(),
        accountId: z.uuid(),
        categoryId: z.uuid().nullable(),
        paymentMethodId: z.uuid().nullable(),
        name: z.string(),
        amount: z.number(),
        type: z.enum(['income', 'expense']),
        dayOfMonth: z.number(),
        monthlyAmounts: z.record(z.string(), z.number()),
        isActive: z.boolean(),
        startPeriod: z.string().nullable(),
        endPeriod: z.string().nullable(),
        lastGeneratedPeriod: z.string().nullable(),
    })
    .openapi('RecurringPayment');

const RecurringInput = z.object({
    accountId: z.uuid(),
    categoryId: z.uuid().nullish(),
    paymentMethodId: z.uuid().nullish(),
    name: z.string().trim().min(1, 'Le nom est requis').max(160),
    amount: z.number().min(0).max(1e12),
    type: z.enum(['income', 'expense']),
    dayOfMonth: z.number().int().min(1).max(31),
    monthlyAmounts: MonthlyAmounts.nullish(),
    isActive: z.boolean().optional(),
    startPeriod: Period.nullish(),
    endPeriod: Period.nullish(),
});

const Occurrence = z.object({
    paymentId: z.uuid(),
    period: z.string(),
    date: z.string(),
    amount: z.number(),
    name: z.string(),
    accountId: z.uuid(),
    type: z.enum(['income', 'expense']),
});

export const listRecurring = async (userId: string) =>
    (await RecurringPayment.findAll({ where: { userId }, order: [['dayOfMonth', 'ASC'], ['name', 'ASC']] })).map(serializeRecurring);

export const recurring = createRouter();
recurring.use('*', authMiddleware);
const recurringTags = ['Mensualités'];

recurring.openapi(
    createRoute({ method: 'get', path: '/', tags: recurringTags, summary: 'Lister les mensualités', security: secured, responses: { 200: json(RecurringSchema.array()), ...errors } }),
    async (c) => c.json(await listRecurring(c.get('auth').userId), 200),
);

recurring.openapi(
    createRoute({ method: 'get', path: '/pending', tags: recurringTags, summary: 'Échéances pas encore passées en écriture', security: secured, responses: { 200: json(Occurrence.array()), ...errors } }),
    async (c) => c.json(await pendingForUser(c.get('auth').userId), 200),
);

recurring.openapi(
    createRoute({
        method: 'post',
        path: '/run',
        tags: recurringTags,
        summary: 'Mettre en place les mensualités maintenant (avec rattrapage des mois manqués)',
        security: secured,
        responses: { 200: json(z.object({ created: z.number(), total: z.number() })), ...errors },
    }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        return c.json(await generateForUser(userId, { mode: 'month_start', origin: sessionId }), 200);
    },
);

recurring.openapi(
    createRoute({
        method: 'post',
        path: '/',
        tags: recurringTags,
        summary: 'Créer une mensualité',
        security: secured,
        request: body(RecurringInput.extend({ id: z.uuid().optional() }).openapi('CreateRecurringInput')),
        responses: { 201: json(RecurringSchema, 'Créée'), 200: json(RecurringSchema, 'Déjà créée (rejeu)'), ...errors },
    }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        const input = c.req.valid('json');
        if (input.id) {
            const existing = await RecurringPayment.findByPk(input.id);
            if (existing) {
                if (existing.userId !== userId) throw conflict('Identifiant déjà utilisé');
                return c.json(serializeRecurring(existing), 200);
            }
        }
        await assertOwned(userId, input);
        const payment = await RecurringPayment.create({
            ...input,
            userId,
            categoryId: input.categoryId ?? null,
            paymentMethodId: input.paymentMethodId ?? null,
            monthlyAmounts: input.monthlyAmounts ?? null,
            startPeriod: input.startPeriod ?? defaultStartPeriod(input.dayOfMonth),
            endPeriod: input.endPeriod ?? null,
        });
        publish(userId, { model: 'recurringPayment', type: 'created', id: payment.id, origin: sessionId });
        return c.json(serializeRecurring(payment), 201);
    },
);

recurring.openapi(
    createRoute({
        method: 'patch',
        path: '/{id}',
        tags: recurringTags,
        summary: 'Modifier une mensualité (les écritures déjà générées ne changent pas)',
        security: secured,
        request: { params: IdParam, ...body(RecurringInput.partial().openapi('UpdateRecurringInput')) },
        responses: { 200: json(RecurringSchema), ...errors },
    }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        const { id } = c.req.valid('param');
        const patch = c.req.valid('json');
        const payment = await RecurringPayment.findOne({ where: { id, userId } });
        if (!payment) throw notFound('Mensualité introuvable');
        await assertOwned(userId, patch);
        await payment.update(patch);
        publish(userId, { model: 'recurringPayment', type: 'updated', id, origin: sessionId });
        return c.json(serializeRecurring(payment), 200);
    },
);

recurring.openapi(
    createRoute({ method: 'delete', path: '/{id}', tags: recurringTags, summary: 'Supprimer une mensualité', security: secured, request: { params: IdParam }, responses: { 200: json(SuccessSchema), ...errors } }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        const { id } = c.req.valid('param');
        if (!(await RecurringPayment.destroy({ where: { id, userId } }))) throw notFound('Mensualité introuvable');
        publish(userId, { model: 'recurringPayment', type: 'deleted', id, origin: sessionId });
        return c.json({ success: true }, 200);
    },
);

// ── Budgets ──────────────────────────────────────────────────────────────────

export const BudgetSchema = z
    .object({
        id: z.uuid(),
        categoryId: z.uuid().nullable(),
        amount: z.number(),
        alertThreshold: z.number(),
        periodFrom: z.string(),
        periodTo: z.string(),
        spent: z.number(),
        remaining: z.number(),
        percent: z.number(),
        projected: z.number(),
    })
    .openapi('Budget');

const BudgetInput = z.object({
    categoryId: z.uuid().nullish().openapi({ description: 'Absent = budget global' }),
    amount: z.number().positive('Le montant doit être supérieur à zéro').max(1e12),
    alertThreshold: z.number().int().min(1).max(100).default(80),
});

export const budgets = createRouter();
budgets.use('*', authMiddleware);
const budgetTags = ['Budgets'];

const budgetWithProgress = async (userId: string, id: string) => {
    const budget = (await getBudgetsProgress(userId)).find((b) => b.id === id);
    if (!budget) throw notFound('Budget introuvable');
    return budget;
};

budgets.openapi(
    createRoute({ method: 'get', path: '/', tags: budgetTags, summary: 'Budgets et avancement sur la période en cours', security: secured, responses: { 200: json(BudgetSchema.array()), ...errors } }),
    async (c) => c.json(await getBudgetsProgress(c.get('auth').userId), 200),
);

budgets.openapi(
    createRoute({
        method: 'post',
        path: '/',
        tags: budgetTags,
        summary: 'Créer un budget (un seul par catégorie)',
        security: secured,
        request: body(BudgetInput.extend({ id: z.uuid().optional() }).openapi('CreateBudgetInput')),
        responses: { 201: json(BudgetSchema, 'Créé'), 200: json(BudgetSchema, 'Déjà créé (rejeu)'), ...errors },
    }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        const input = c.req.valid('json');
        if (input.id) {
            const existing = await Budget.findByPk(input.id);
            if (existing) {
                if (existing.userId !== userId) throw conflict('Identifiant déjà utilisé');
                return c.json(await budgetWithProgress(userId, existing.id), 200);
            }
        }
        if (input.categoryId && !(await Category.findOne({ where: { id: input.categoryId, userId } }))) throw notFound('Catégorie introuvable');
        try {
            const budget = await Budget.create({ ...input, categoryId: input.categoryId ?? null, userId });
            publish(userId, { model: 'budget', type: 'created', id: budget.id, origin: sessionId });
            return c.json(await budgetWithProgress(userId, budget.id), 201);
        } catch (error) {
            if (error instanceof UniqueConstraintError) throw conflict('Un budget existe déjà pour cette catégorie');
            throw error;
        }
    },
);

budgets.openapi(
    createRoute({
        method: 'patch',
        path: '/{id}',
        tags: budgetTags,
        summary: 'Modifier un budget',
        security: secured,
        request: { params: IdParam, ...body(BudgetInput.pick({ amount: true, alertThreshold: true }).partial().openapi('UpdateBudgetInput')) },
        responses: { 200: json(BudgetSchema), ...errors },
    }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        const { id } = c.req.valid('param');
        const budget = await Budget.findOne({ where: { id, userId } });
        if (!budget) throw notFound('Budget introuvable');
        await budget.update(c.req.valid('json'));
        publish(userId, { model: 'budget', type: 'updated', id, origin: sessionId });
        return c.json(await budgetWithProgress(userId, id), 200);
    },
);

budgets.openapi(
    createRoute({ method: 'delete', path: '/{id}', tags: budgetTags, summary: 'Supprimer un budget', security: secured, request: { params: IdParam }, responses: { 200: json(SuccessSchema), ...errors } }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        const { id } = c.req.valid('param');
        if (!(await Budget.destroy({ where: { id, userId } }))) throw notFound('Budget introuvable');
        publish(userId, { model: 'budget', type: 'deleted', id, origin: sessionId });
        return c.json({ success: true }, 200);
    },
);

// ── Notifications ────────────────────────────────────────────────────────────

const NotificationSchema = z
    .object({
        id: z.uuid(),
        type: z.string(),
        title: z.string(),
        body: z.string(),
        data: z.record(z.string(), z.string()).nullable(),
        read: z.boolean(),
        createdAt: z.string(),
    })
    .openapi('Notification');

export const unreadCount = (userId: string) => Notification.count({ where: { userId, readAt: null } });

export const notifications = createRouter();
notifications.use('*', authMiddleware);
const notificationTags = ['Notifications'];

notifications.openapi(
    createRoute({
        method: 'get',
        path: '/',
        tags: notificationTags,
        summary: 'Centre de notifications',
        security: secured,
        request: { query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).default(0) }) },
        responses: { 200: json(z.object({ items: NotificationSchema.array(), unreadCount: z.number() })), ...errors },
    }),
    async (c) => {
        const { userId } = c.get('auth');
        const { limit, offset } = c.req.valid('query');
        const [rows, unread] = await Promise.all([
            Notification.findAll({ where: { userId }, order: [['createdAt', 'DESC']], limit, offset }),
            unreadCount(userId),
        ]);
        return c.json(
            {
                items: rows.map((n) => ({
                    id: n.id,
                    type: n.type,
                    title: n.title,
                    body: n.body,
                    data: n.data,
                    read: n.readAt !== null,
                    createdAt: n.createdAt.toISOString(),
                })),
                unreadCount: unread,
            },
            200,
        );
    },
);

notifications.openapi(
    createRoute({
        method: 'post',
        path: '/read',
        tags: notificationTags,
        summary: 'Marquer comme lues (toutes si `ids` est absent)',
        security: secured,
        request: body(z.object({ ids: z.uuid().array().max(500).optional() })),
        responses: { 200: json(z.object({ unreadCount: z.number() })), ...errors },
    }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        const { ids } = c.req.valid('json');
        await Notification.update({ readAt: new Date() }, { where: { userId, readAt: null, ...(ids ? { id: { [Op.in]: ids } } : {}) } });
        publish(userId, { model: 'notification', type: 'bulk', origin: sessionId });
        return c.json({ unreadCount: await unreadCount(userId) }, 200);
    },
);

notifications.openapi(
    createRoute({ method: 'delete', path: '/', tags: notificationTags, summary: 'Vider le centre de notifications', security: secured, responses: { 200: json(SuccessSchema), ...errors } }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        await Notification.destroy({ where: { userId } });
        publish(userId, { model: 'notification', type: 'bulk', origin: sessionId });
        return c.json({ success: true }, 200);
    },
);

notifications.openapi(
    createRoute({ method: 'delete', path: '/{id}', tags: notificationTags, summary: 'Supprimer une notification', security: secured, request: { params: IdParam }, responses: { 200: json(SuccessSchema), ...errors } }),
    async (c) => {
        const { userId } = c.get('auth');
        if (!(await Notification.destroy({ where: { id: c.req.valid('param').id, userId } }))) throw notFound('Notification introuvable');
        return c.json({ success: true }, 200);
    },
);
