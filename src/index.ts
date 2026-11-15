import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import sequelize from './config/database.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { runRecurringJob, startJobs } from './services/jobs.js';
import { initPush } from './services/push.js';
import { settleSideEffects } from './services/transactions.js';

const start = async () => {
    try {
        // Le schéma est géré exclusivement par les migrations (`pnpm migrate`), jamais par sync().
        await sequelize.authenticate();
    } catch (error) {
        logger.error(error, 'Connexion à la base de données impossible');
        process.exit(1);
    }

    await initPush();
    const server = serve({ fetch: createApp().fetch, port: env.PORT });
    logger.info(`Moneo API à l'écoute sur le port ${env.PORT}`);

    startJobs();
    // Rattrapage au démarrage : si le serveur était arrêté à minuit, les mensualités ne sont pas perdues.
    void runRecurringJob();

    const shutdown = async (signal: string) => {
        logger.info(`${signal} reçu, arrêt en cours`);
        server.close();
        await settleSideEffects();
        await sequelize.close();
        process.exit(0);
    };
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
};

process.on('unhandledRejection', (reason) => logger.error(reason, 'Promesse rejetée non interceptée'));
process.on('uncaughtException', (err) => {
    logger.error(err, 'Exception non interceptée');
    process.exit(1);
});

void start();
