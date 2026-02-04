import {serve} from '@hono/node-server';
import {OpenAPIHono} from '@hono/zod-openapi';
import {logger} from 'hono/logger';
import {cors} from 'hono/cors';
import {swaggerUI} from '@hono/swagger-ui';
import {streamSSE} from 'hono/streaming';
import {EventEmitter} from 'node:events';
import sequelize from './config/database.js';
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

const app = new OpenAPIHono();
const eventBus = new EventEmitter();
eventBus.setMaxListeners(1000);

const port = Number(process.env.PORT) || 3000;

app.use('*', logger());
app.use('*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Content-Length', 'X-Total-Count'],
    maxAge: 600,
}));

// --- CONFIGURATION V1 ---
const v1 = new OpenAPIHono();

v1.route('/auth', authRoutes);
v1.route('/accounts', accountRoutes);
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
        description: 'API Real-time avec Hono et Zod-OpenAPI',
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

        console.log(`🚀 Server running on port ${port} | Docs: http://localhost:${port}/api-docs`);
        serve({fetch: app.fetch, port});
    } catch (error) {
        console.error('❌ Database connection failed:', error);
        process.exit(1);
    }
};

startServer();