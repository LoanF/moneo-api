import { createRoute, z } from '@hono/zod-openapi';
import { IdParam, SuccessSchema, body, createRouter, errors, json, secured } from '../lib/http.js';
import { authMiddleware } from '../middleware/auth.js';
import {
    createBatch,
    createTransaction,
    createTransfer,
    deleteTransaction,
    getTransaction,
    listTransactions,
    serializeTransaction,
    setChecked,
    suggestTransactions,
    updateTransaction,
} from '../services/transactions.js';

const Amount = z.number().finite().min(-1e12).max(1e12);
const ISODate = z.iso.date('Date invalide (AAAA-MM-JJ)');
const QueryBool = z.enum(['true', 'false']).transform((v) => v === 'true');

export const TransactionSchema = z
    .object({
        id: z.uuid(),
        accountId: z.uuid(),
        categoryId: z.uuid().nullable(),
        paymentMethodId: z.uuid().nullable(),
        chequebookId: z.uuid().nullable(),
        chequeNumber: z.string().nullable(),
        amount: z.number().openapi({ description: 'Montant signé : négatif = sortie, positif = entrée' }),
        type: z.enum(['income', 'expense', 'transfer']),
        date: z.string(),
        note: z.string().nullable(),
        isChecked: z.boolean(),
        transferId: z.uuid().nullable(),
        counterparty: z.string().nullable(),
        recurringPaymentId: z.uuid().nullable(),
        source: z.string(),
        createdAt: z.string(),
        updatedAt: z.string(),
        deletedAt: z.string().nullable(),
    })
    .openapi('Transaction');

const TransactionInput = z.object({
    accountId: z.uuid(),
    type: z.enum(['income', 'expense']),
    amount: Amount.openapi({ description: 'Le signe est ignoré : il est déduit du type' }),
    date: ISODate.nullish(),
    note: z.string().max(255).nullish(),
    categoryId: z.uuid().nullish(),
    paymentMethodId: z.uuid().nullish(),
    chequebookId: z.uuid().nullish(),
    chequeNumber: z.string().max(20).nullish(),
    isChecked: z.boolean().optional(),
});
const CreateTransactionInput = TransactionInput.extend({ id: z.uuid().optional() }).openapi('CreateTransactionInput');

const transactions = createRouter();
transactions.use('*', authMiddleware);
const tags = ['Opérations'];

transactions.openapi(
    createRoute({
        method: 'get',
        path: '/',
        tags,
        summary: 'Lister et filtrer les opérations',
        security: secured,
        request: {
            query: z.object({
                accountId: z.uuid().optional(),
                categoryId: z.uuid().optional(),
                paymentMethodId: z.uuid().optional(),
                type: z.enum(['income', 'expense', 'transfer']).optional(),
                isChecked: QueryBool.optional(),
                from: ISODate.optional(),
                to: ISODate.optional(),
                q: z.string().max(100).optional(),
                minAmount: z.coerce.number().nonnegative().optional(),
                maxAmount: z.coerce.number().nonnegative().optional(),
                updatedSince: z.iso.datetime({ offset: true }).optional(),
                sort: z.enum(['date_desc', 'date_asc', 'amount_desc', 'amount_asc']).optional(),
                limit: z.coerce.number().int().min(1).max(1000).default(50),
                offset: z.coerce.number().int().min(0).default(0),
            }),
        },
        responses: {
            200: json(
                z.object({
                    items: TransactionSchema.array(),
                    total: z.number(),
                    sumCredit: z.number(),
                    sumDebit: z.number(),
                }).openapi('TransactionPage'),
            ),
            ...errors,
        },
    }),
    async (c) => c.json(await listTransactions(c.get('auth').userId, c.req.valid('query')), 200),
);

transactions.openapi(
    createRoute({
        method: 'get',
        path: '/suggestions',
        tags,
        summary: 'Suggestions de saisie d’après les libellés déjà utilisés',
        security: secured,
        request: { query: z.object({ q: z.string().max(100).default('') }) },
        responses: {
            200: json(
                z.object({
                    note: z.string(),
                    categoryId: z.uuid().nullable(),
                    paymentMethodId: z.uuid().nullable(),
                    accountId: z.uuid(),
                    type: z.enum(['income', 'expense']),
                    amount: z.number(),
                    uses: z.number(),
                }).array(),
            ),
            ...errors,
        },
    }),
    async (c) => c.json(await suggestTransactions(c.get('auth').userId, c.req.valid('query').q), 200),
);

transactions.openapi(
    createRoute({
        method: 'post',
        path: '/',
        tags,
        summary: 'Créer une opération (idempotent si `id` est fourni)',
        security: secured,
        request: body(CreateTransactionInput),
        responses: { 201: json(TransactionSchema, 'Créée'), 200: json(TransactionSchema, 'Déjà créée (rejeu)'), ...errors },
    }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        const { row, created } = await createTransaction(userId, c.req.valid('json'), sessionId);
        return c.json(serializeTransaction(row), created ? 201 : 200);
    },
);

transactions.openapi(
    createRoute({
        method: 'post',
        path: '/batch',
        tags,
        summary: 'Rejouer une file d’opérations créées hors-ligne',
        security: secured,
        request: body(z.object({ transactions: CreateTransactionInput.array().min(1).max(500) }).openapi('BatchInput')),
        responses: {
            200: json(
                z.object({
                    results: z.object({ id: z.string().nullable(), status: z.enum(['created', 'exists', 'error']), error: z.string().optional() }).array(),
                }),
            ),
            ...errors,
        },
    }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        return c.json({ results: await createBatch(userId, c.req.valid('json').transactions, sessionId) }, 200);
    },
);

transactions.openapi(
    createRoute({
        method: 'post',
        path: '/transfers',
        tags,
        summary: 'Transférer entre deux comptes (ou vers un compte externe)',
        security: secured,
        request: body(
            z.object({
                id: z.uuid().optional().openapi({ description: 'Identifiant du transfert, pour l’idempotence' }),
                fromAccountId: z.uuid(),
                toAccountId: z.uuid().nullish(),
                counterparty: z.string().max(120).nullish(),
                amount: z.number().positive('Le montant doit être supérieur à zéro').max(1e12),
                date: ISODate.nullish(),
                note: z.string().max(255).nullish(),
                categoryId: z.uuid().nullish(),
                isChecked: z.boolean().optional(),
            }).openapi('CreateTransferInput'),
        ),
        responses: {
            201: json(z.object({ transferId: z.uuid(), transactions: TransactionSchema.array() }).openapi('Transfer'), 'Créé'),
            200: json(z.object({ transferId: z.uuid(), transactions: TransactionSchema.array() }), 'Déjà créé (rejeu)'),
            ...errors,
        },
    }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        const { rows, created } = await createTransfer(userId, c.req.valid('json'), sessionId);
        return c.json({ transferId: rows[0].transferId as string, transactions: rows.map(serializeTransaction) }, created ? 201 : 200);
    },
);

transactions.openapi(
    createRoute({
        method: 'post',
        path: '/check',
        tags,
        summary: 'Pointer ou dépointer plusieurs opérations',
        security: secured,
        request: body(z.object({ ids: z.uuid().array().min(1).max(1000), isChecked: z.boolean() }).openapi('CheckInput')),
        responses: { 200: json(z.object({ updated: z.number() })), ...errors },
    }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        const { ids, isChecked } = c.req.valid('json');
        return c.json({ updated: await setChecked(userId, ids, isChecked, sessionId) }, 200);
    },
);

transactions.openapi(
    createRoute({ method: 'get', path: '/{id}', tags, summary: 'Détail d’une opération', security: secured, request: { params: IdParam }, responses: { 200: json(TransactionSchema), ...errors } }),
    async (c) => c.json(serializeTransaction(await getTransaction(c.get('auth').userId, c.req.valid('param').id)), 200),
);

transactions.openapi(
    createRoute({
        method: 'patch',
        path: '/{id}',
        tags,
        summary: 'Modifier une opération',
        security: secured,
        request: { params: IdParam, ...body(TransactionInput.partial().openapi('UpdateTransactionInput')) },
        responses: { 200: json(TransactionSchema), ...errors },
    }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        const row = await updateTransaction(userId, c.req.valid('param').id, c.req.valid('json'), sessionId);
        return c.json(serializeTransaction(row), 200);
    },
);

transactions.openapi(
    createRoute({
        method: 'delete',
        path: '/{id}',
        tags,
        summary: 'Supprimer une opération (les deux jambes pour un transfert)',
        security: secured,
        request: { params: IdParam },
        responses: { 200: json(SuccessSchema), ...errors },
    }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        await deleteTransaction(userId, c.req.valid('param').id, sessionId);
        return c.json({ success: true }, 200);
    },
);

export default transactions;
