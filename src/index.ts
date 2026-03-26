import {serve} from '@hono/node-server';
import {OpenAPIHono} from '@hono/zod-openapi';
import {logger as honoLogger} from 'hono/logger';
import {cors} from 'hono/cors';
import {logger} from './utils/logger.js';
import {swaggerUI} from '@hono/swagger-ui';
import {streamSSE} from 'hono/streaming';
import {EventEmitter} from 'node:events';
import sequelize from './config/database.js';
import type { AppEnv } from './types.js';
import {authMiddleware} from './middleware/auth.js';
import {processMonthlyPayments} from './services/monthlyProcessor.js';

// Routes
import authRoutes from './routes/auth.js';
import accountRoutes from './routes/bankAccount.js';
import categoryRoutes from './routes/category.js';
import paymentMethodRoutes from './routes/paymentMethod.js';
import monthlyPaymentRoutes from './routes/monthlyPayment.js';
import transactionRoutes from './routes/transaction.js';

// Models Sequelize
import './models/User.js';
import './models/BankAccount.js';
import './models/Category.js';
import './models/PaymentMethod.js';
import './models/MonthlyPayment.js';
import './models/Transaction.js';

import pkg from '../package.json' with {type: 'json'};

const app = new OpenAPIHono<AppEnv>();
const eventBus = new EventEmitter();
eventBus.setMaxListeners(1000);

const port = Number(process.env.PORT) || 3000;

app.use('*', honoLogger());
app.use('*', cors({
    origin: (process.env.ALLOWED_ORIGINS || '*').split(','),
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Content-Length', 'X-Total-Count'],
    maxAge: 600,
}));

// --- CONFIGURATION V1 ---
const v1 = new OpenAPIHono<AppEnv>();

v1.route('/auth', authRoutes);
v1.route('/bank-accounts', accountRoutes);
v1.route('/categories', categoryRoutes);
v1.route('/payment-methods', paymentMethodRoutes);
v1.route('/monthly-payments', monthlyPaymentRoutes);
v1.route('/transactions', transactionRoutes);

v1.get('/realtime', authMiddleware, async (c) => {
    const user = c.get('jwtPayload');

    return streamSSE(c, async (stream) => {
        const listener = (payload: any) => {
            if (payload.userId === user.id) {
                stream.writeSSE({
                    data: JSON.stringify({
                        type: payload.type,
                        model: payload.model,
                        data: payload.data
                    }),
                    event: 'message',
                });
            }
        };

        eventBus.on('db_change', listener);

        stream.onAbort(() => {
            eventBus.off('db_change', listener);
        });

        while (true) {
            await stream.sleep(30000);
            try {
                await stream.writeSSE({data: 'heartbeat', event: 'ping'});
            } catch {
                eventBus.off('db_change', listener);
                break;
            }
        }
    });
});

// --- DOCUMENTATION ---

app.get('/api-docs', (c) => c.redirect('/api-docs/', 301));
app.get(
    '/api-docs/',
    swaggerUI({
        url: '/api/v1/openapi.json',
        docExpansion: 'list',
        filter: true,
        tagsSorter: "'alpha'",
        operationsSorter: "'method'",
    })
);

v1.doc('/openapi.json', {
    openapi: '3.1.0',
    info: {
        title: 'Moneo API V1',
        version: pkg.version,
        description: `
## Overview
Moneo is a high-performance personal finance management API built with **Hono** and **Zod-OpenAPI**. It provides secure, type-safe endpoints to manage bank accounts, transactions, and budgets.

## Key Features
* **Real-time Synchronization**: Powered by SSE (Server-Sent Events) to keep client data in sync across all devices.
* **Secure Authentication**: JWT-based security with support for classic email/password and Google OAuth.
* **Type Safety**: Full Zod integration ensuring rigorous data validation for every request and response.
* **Automated Operations**: Built-in support for processing monthly recurring payments.

## Getting Started
Most endpoints require a valid **Bearer Token** in the authorization header. You can obtain one by using the \`/auth/login\` or \`/auth/google\` endpoints.
        `.trim(),
    },
    servers: [{url: `http://localhost:${port}/api/v1`, description: 'Serveur V1'}],
});

v1.openAPIRegistry.registerComponent('securitySchemes', 'Bearer', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
});

app.route('/api/v1', v1);

// --- LOGIQUE SEQUELIZE & START ---

const emitChange = (type: string, instance: any) => {
    let ownerId: number | null;
    const modelName = instance.constructor.name;

    if (modelName === 'User') {
        ownerId = instance.id;
    } else {
        ownerId = instance.userId || (instance.dataValues && instance.dataValues.userId);
    }

    eventBus.emit('db_change', {
        type,
        model: modelName,
        userId: ownerId,
        data: instance.toJSON ? instance.toJSON() : instance
    });
};

sequelize.addHook('afterCreate', (instance) => emitChange('CREATE', instance));
sequelize.addHook('afterUpdate', (instance) => emitChange('UPDATE', instance));
sequelize.addHook('afterDestroy', (instance) => emitChange('DELETE', instance));

app.get('/', (c) => c.text('Moneo API is Live'));

const startServer = async () => {
    try {
        await sequelize.authenticate();
        if (process.env.NODE_ENV !== 'production') {
            await sequelize.sync({alter: true});
        }

        await processMonthlyPayments();

        logger.info(`Server running on port ${port} | Docs: http://localhost:${port}/api-docs`);
        serve({fetch: app.fetch, port});
    } catch (error) {
        logger.error(error, 'Database connection failed');
        process.exit(1);
    }
};

startServer();