import { describe, it, expect, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);

const hasDatabaseConfig = Boolean(
    process.env.DATABASE_URL ||
    (process.env.POSTGRES_USER && process.env.POSTGRES_PASSWORD && process.env.POSTGRES_DB)
);

const sequelizeCliBin = path.resolve(process.cwd(), 'node_modules/sequelize-cli/lib/sequelize');

function runSequelizeCli(command: string) {
    return execFileAsync(process.execPath, [sequelizeCliBin, command, '--env', 'test'], {
        env: process.env,
    });
}

describe.skipIf(!hasDatabaseConfig)('migrations', () => {
    afterAll(async () => {
        await runSequelizeCli('db:migrate:undo:all');
    });

    it('applique toutes les migrations sans erreur sur une base vierge', async () => {
        await runSequelizeCli('db:migrate');
    }, 30000);

    it('rejouer les migrations est sans effet et ne casse rien', async () => {
        const { stdout } = await runSequelizeCli('db:migrate');
        expect(stdout).toContain('No migrations were executed, database schema was already up to date.');
    }, 30000);
});
