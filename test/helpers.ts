import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { User } from '../src/db/models.js';
import { hashPassword } from '../src/lib/password.js';
import { createSession } from '../src/services/auth.js';
import { seedUserDefaults } from '../src/services/seed.js';

export const app = createApp();
export const PASSWORD = 'correct horse battery';

export type Api = <T = any>(method: string, path: string, body?: unknown) => Promise<{ status: number; body: T; headers: Headers }>;

const call = (token?: string): Api => async (method, path, body) => {
    const response = await app.request(`/api/v1${path}`, {
        method,
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let parsed: unknown = text;
    try {
        parsed = JSON.parse(text);
    } catch {
        /* réponse non JSON (CSV, texte) */
    }
    return { status: response.status, body: parsed as never, headers: response.headers };
};

export const anonymous = call();

/** Crée un utilisateur vérifié directement en base (sans passer par /register et son rate limit). */
export const createUser = async (overrides: Partial<{ settings: object; notificationPrefs: object }> = {}) => {
    const user = await User.create({
        username: 'Testeur',
        email: `${randomUUID()}@moneo.test`,
        passwordHash: await hashPassword(PASSWORD),
        emailVerifiedAt: new Date(),
        hasCompletedSetup: true,
        ...overrides,
    });
    await seedUserDefaults(user.id);
    const tokens = await createSession(user, { deviceName: 'Vitest' });
    return { user, ...tokens, api: call(tokens.accessToken) };
};

export const createAccount = async (api: Api, name = 'Compte', initialBalance = 0) =>
    (await api('POST', '/accounts', { name, initialBalance })).body as { id: string; balance: number };

export const balanceOf = async (api: Api, accountId: string) => {
    const accounts = (await api('GET', '/accounts')).body as any[];
    return accounts.find((a) => a.id === accountId);
};
