import { serveStatic } from '@hono/node-server/serve-static';
import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono } from '@hono/zod-openapi';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { streamSSE } from 'hono/streaming';
import pkg from '../package.json' with { type: 'json' };
import { env } from './config/env.js';
import { User, sequelize } from './db/models.js';
import { HttpError } from './lib/errors.js';
import { subscribe } from './lib/events.js';
import type { AppEnv } from './lib/http.js';
import { logger } from './lib/logger.js';
import { authMiddleware } from './middleware/auth.js';
import { rateLimit } from './middleware/rateLimiter.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import accountRoutes from './routes/accounts.js';
import authRoutes from './routes/auth.js';
import { categories, chequebooks, listCategories, listChequebooks, listPaymentMethods, paymentMethods } from './routes/catalog.js';
import dataRoutes from './routes/data.js';
import { budgets, listRecurring, notifications, recurring, stats, unreadCount } from './routes/insights.js';
import transactionRoutes from './routes/transactions.js';
import { serializeUser } from './services/auth.js';
import { listAccountsWithBalances } from './services/balances.js';
import { pendingForUser } from './services/recurring.js';
import { getBudgetsProgress } from './services/stats.js';

export const createApp = (): OpenAPIHono<AppEnv> => {
    const app = new OpenAPIHono<AppEnv>();

    app.use('*', securityHeaders);
    // Sans ALLOWED_ORIGINS, aucune origine navigateur n'est autorisée : l'app mobile n'a pas besoin de CORS.
    const origins = (env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
    app.use(
        '*',
        cors({
            origin: (origin) => (origins.includes('*') ? origin : origins.includes(origin) ? origin : null),
            allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
            allowHeaders: ['Content-Type', 'Authorization'],
            maxAge: 600,
        }),
    );
    app.use('*', async (c, next) => {
        const start = Date.now();
        await next();
        if (c.req.path !== '/health') {
            logger.info({ method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - start }, 'requête');
        }
    });

    app.use('/assets/*', serveStatic({ root: './' }));

    const v1 = new OpenAPIHono<AppEnv>();
    // Plafond global des corps de requête ; l'import a sa propre limite, plus haute.
    v1.use('*', async (c, next) => {
        if (c.req.path.includes('/data/import/')) return next();
        return bodyLimit({ maxSize: 3 * 1024 * 1024, onError: (ctx) => ctx.json({ error: 'Requête trop volumineuse' }, 413) })(c, next);
    });
    v1.use('*', rateLimit(600, 60 * 1000));

    v1.route('/auth', authRoutes);
    v1.route('/accounts', accountRoutes);
    v1.route('/categories', categories);
    v1.route('/payment-methods', paymentMethods);
    v1.route('/chequebooks', chequebooks);
    v1.route('/transactions', transactionRoutes);
    v1.route('/recurring-payments', recurring);
    v1.route('/budgets', budgets);
    v1.route('/stats', stats);
    v1.route('/notifications', notifications);
    v1.route('/data', dataRoutes);

    /** Tout ce qu'il faut pour afficher l'app au lancement, en un seul aller-retour. */
    v1.get('/bootstrap', authMiddleware, async (c) => {
        const { userId } = c.get('auth');
        const user = await User.findByPk(userId);
        if (!user) return c.json({ error: 'Compte introuvable', code: 'account_deleted' }, 401);
        const [accounts, categoryList, methods, books, recurringList, budgetList, unread, pending] = await Promise.all([
            listAccountsWithBalances(userId),
            listCategories(userId),
            listPaymentMethods(userId),
            listChequebooks(userId),
            listRecurring(userId),
            getBudgetsProgress(userId),
            unreadCount(userId),
            pendingForUser(userId),
        ]);
        return c.json({
            user: serializeUser(user),
            accounts,
            categories: categoryList,
            paymentMethods: methods,
            chequebooks: books,
            recurringPayments: recurringList,
            budgets: budgetList,
            unreadNotifications: unread,
            pendingRecurring: pending.length,
            serverTime: new Date().toISOString(),
        });
    });

    /** Flux temps réel : chaque changement est signalé, le client recharge ce qui le concerne. */
    v1.get('/realtime', authMiddleware, (c) => {
        const { userId } = c.get('auth');
        return streamSSE(c, async (stream) => {
            let open = true;
            const unsubscribe = subscribe(userId, (event) => {
                stream.writeSSE({ event: 'change', data: JSON.stringify(event) }).catch(() => {
                    open = false;
                });
            });
            stream.onAbort(() => {
                open = false;
                unsubscribe();
            });
            await stream.writeSSE({ event: 'ready', data: '{}' });
            while (open) {
                await stream.sleep(25_000);
                try {
                    await stream.writeSSE({ event: 'ping', data: '{}' });
                } catch {
                    open = false;
                }
            }
            unsubscribe();
        });
    });

    v1.doc('/openapi.json', {
        openapi: '3.1.0',
        info: {
            title: 'Moneo API',
            version: pkg.version,
            description:
                'API de suivi de comptes personnels : comptes à soldes calculés, opérations pointables, transferts, ' +
                'mensualités, chéquiers, budgets, statistiques et synchronisation temps réel (SSE).',
        },
        servers: [{ url: env.PUBLIC_API_URL }],
    });
    v1.openAPIRegistry.registerComponent('securitySchemes', 'Bearer', { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });

    app.route('/api/v1', v1);

    if (env.NODE_ENV !== 'production' || process.env.ENABLE_API_DOCS === 'true') {
        app.get('/api-docs', swaggerUI({ url: '/api/v1/openapi.json', docExpansion: 'list', filter: true }));
    }

    app.get('/', (c) => c.text('Moneo API'));

    app.get('/health', async (c) => {
        const start = Date.now();
        let database = 'connected';
        try {
            await sequelize.authenticate();
        } catch {
            database = 'disconnected';
        }
        return c.json(
            {
                status: database === 'connected' ? 'ok' : 'degraded',
                version: pkg.version,
                uptime: Math.floor(process.uptime()),
                database,
                responseTime: `${Date.now() - start}ms`,
            },
            database === 'connected' ? 200 : 503,
        );
    });

    app.notFound((c) => c.json({ error: 'Route introuvable', code: 'not_found' }, 404));

    app.onError((err, c) => {
        if (err instanceof HttpError) return c.json({ error: err.message, ...(err.code ? { code: err.code } : {}) }, err.status);
        // Erreurs levées par Hono lui-même (JSON malformé, corps trop gros…) : on garde leur statut.
        if (err instanceof HTTPException && err.status < 500) {
            return c.json({ error: 'Requête invalide', code: 'bad_request' }, err.status);
        }
        logger.error(err, 'Erreur non interceptée');
        return c.json({ error: 'Une erreur interne est survenue', code: 'internal_error' }, 500);
    });

    return app;
};
