import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { Sequelize } from 'sequelize';

/**
 * Les tests d'intégration tournent sur un vrai PostgreSQL :
 * - en CI, celui du service `postgres` (DATABASE_URL fourni) ;
 * - en local, un PostgreSQL embarqué démarré pour la durée des tests.
 * Le schéma est créé par la migration elle-même, qui est donc testée au passage.
 */
export const TEST_DB = { user: 'moneo_test', password: 'moneo_test', database: 'moneo_test', port: 54329 };
export const TEST_DATABASE_URL = `postgres://${TEST_DB.user}:${TEST_DB.password}@127.0.0.1:${TEST_DB.port}/${TEST_DB.database}`;

const require = createRequire(import.meta.url);

export default async function setup() {
    const external = process.env.TEST_DATABASE_URL;
    let embedded: EmbeddedPostgres | null = null;
    let dataDir: string | null = null;

    if (!external) {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moneo-pg-'));
        embedded = new EmbeddedPostgres({
            databaseDir: dataDir,
            user: TEST_DB.user,
            password: TEST_DB.password,
            port: TEST_DB.port,
            persistent: false,
            // Sous Windows, initdb choisit sinon l'encodage du système (WIN1252).
            initdbFlags: ['--encoding=UTF8', '--locale=C'],
            onLog: () => {},
            onError: () => {},
        });
        await embedded.initialise();
        await embedded.start();
        await embedded.createDatabase(TEST_DB.database);
    }

    const sequelize = new Sequelize(external ?? TEST_DATABASE_URL, { logging: false });
    const migration = require('../migrations/20261114000000-moneo-v2.cjs');
    const queryInterface = sequelize.getQueryInterface();
    await migration.down(queryInterface);
    await migration.up(queryInterface);
    // Rejouer down/up prouve que la migration est réversible et repart d'une base propre.
    await migration.down(queryInterface);
    await migration.up(queryInterface);
    await sequelize.close();

    return async () => {
        await embedded?.stop();
        if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
    };
}
