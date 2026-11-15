import { describe, expect, it, vi } from 'vitest';

const mail = vi.hoisted(() => ({ codes: new Map<string, string>() }));
vi.mock('../src/services/mailer.js', () => ({
    sendVerificationEmail: (to: string, code: string) => mail.codes.set(`verify:${to}`, code),
    sendPasswordResetEmail: (to: string, code: string) => mail.codes.set(`reset:${to}`, code),
}));

import { randomUUID } from 'node:crypto';
import { Session, Transaction, User } from '../src/db/models.js';
import { REFRESH_GRACE_MS } from '../src/lib/tokens.js';
import { PASSWORD, anonymous, app, createAccount, createUser } from './helpers.js';

const newEmail = () => `${randomUUID()}@moneo.test`;

describe('inscription et connexion', () => {
    it('crée le compte, ses catégories par défaut et une session', async () => {
        const email = newEmail();
        const res = await anonymous('POST', '/auth/register', {
            username: 'Loan',
            email: email.toUpperCase(),
            password: PASSWORD,
            deviceName: 'Pixel',
        });
        expect(res.status).toBe(201);
        expect(res.body.user).toMatchObject({ email, emailVerified: false, hasPassword: true });
        expect(res.body.user).not.toHaveProperty('passwordHash');
        expect(res.body.user.settings.recurringMode).toBe('month_start');
        expect(res.body.accessToken).toBeTruthy();

        const user = await User.findOne({ where: { email } });
        expect(user!.passwordHash).not.toBe(PASSWORD);
        const session = await Session.findOne({ where: { userId: user!.id } });
        expect(session!.deviceName).toBe('Pixel');
        // Le refresh token n'est jamais stocké en clair.
        expect(session!.tokenHash).not.toContain(res.body.refreshToken.split('.')[1]);

        const categories = await app.request('/api/v1/categories', { headers: { Authorization: `Bearer ${res.body.accessToken}` } });
        expect((await categories.json()).length).toBeGreaterThan(10);
    });

    it('refuse un email déjà pris, sans distinguer la casse', async () => {
        const email = newEmail();
        await anonymous('POST', '/auth/register', { username: 'Loan', email, password: PASSWORD });
        const res = await anonymous('POST', '/auth/register', { username: 'Loan', email: email.toUpperCase(), password: PASSWORD });
        expect(res.status).toBe(409);
    });

    it('connecte quelle que soit la casse de l’email', async () => {
        const { user } = await createUser();
        const res = await anonymous('POST', '/auth/login', { email: `  ${user.email.toUpperCase()} `, password: PASSWORD });
        expect(res.status).toBe(200);
        expect(res.body.user.id).toBe(user.id);
    });

    it('répond 401 sans détail pour un mauvais mot de passe ou un compte inconnu', async () => {
        const { user } = await createUser();
        const wrong = await anonymous('POST', '/auth/login', { email: user.email, password: 'nope-nope-nope' });
        const unknown = await anonymous('POST', '/auth/login', { email: newEmail(), password: PASSWORD });
        expect(wrong.status).toBe(401);
        expect(unknown.status).toBe(401);
        expect(wrong.body.error).toBe(unknown.body.error);
    });

    it('bloque le bourrage d’identifiants sur un même compte', async () => {
        const { user } = await createUser();
        let last = 0;
        for (let i = 0; i < 11; i++) {
            last = (await anonymous('POST', '/auth/login', { email: user.email, password: 'mauvais-mdp' })).status;
        }
        expect(last).toBe(429);
    });

    it('rejette les requêtes sans jeton', async () => {
        expect((await anonymous('GET', '/auth/me')).status).toBe(401);
        expect((await anonymous('GET', '/accounts')).status).toBe(401);
        expect((await anonymous('GET', '/bootstrap')).status).toBe(401);
    });
});

describe('sessions et rotation du refresh token', () => {
    it('fait tourner le refresh token et garde plusieurs appareils connectés', async () => {
        const { user, refreshToken, api } = await createUser();
        const second = await anonymous('POST', '/auth/login', { email: user.email, password: PASSWORD, deviceName: 'iPad' });

        const rotated = await anonymous('POST', '/auth/refresh', { refreshToken });
        expect(rotated.status).toBe(200);
        expect(rotated.body.refreshToken).not.toBe(refreshToken);

        // Le second appareil n'est pas déconnecté par la rotation du premier.
        expect((await anonymous('POST', '/auth/refresh', { refreshToken: second.body.refreshToken })).status).toBe(200);
        const sessions = await api('GET', '/auth/sessions');
        expect(sessions.body).toHaveLength(2);
        expect(sessions.body.filter((s: any) => s.current)).toHaveLength(1);
    });

    it('accepte l’ancien jeton pendant la fenêtre de grâce (requêtes concurrentes)', async () => {
        const { refreshToken } = await createUser();
        const [a, b] = await Promise.all([
            anonymous('POST', '/auth/refresh', { refreshToken }),
            anonymous('POST', '/auth/refresh', { refreshToken }),
        ]);
        expect(a.status).toBe(200);
        expect(b.status).toBe(200);
    });

    it('révoque la session quand un ancien jeton est rejoué hors fenêtre de grâce', async () => {
        const { user, refreshToken } = await createUser();
        const rotated = await anonymous('POST', '/auth/refresh', { refreshToken });
        await Session.update({ rotatedAt: new Date(Date.now() - REFRESH_GRACE_MS - 1000) }, { where: { userId: user.id } });

        expect((await anonymous('POST', '/auth/refresh', { refreshToken })).status).toBe(401);
        // Le jeton légitime est lui aussi invalidé : la session entière est considérée compromise.
        expect((await anonymous('POST', '/auth/refresh', { refreshToken: rotated.body.refreshToken })).status).toBe(401);
    });

    it('la déconnexion invalide le refresh token', async () => {
        const { api, refreshToken } = await createUser();
        expect((await api('POST', '/auth/logout')).status).toBe(200);
        expect((await anonymous('POST', '/auth/refresh', { refreshToken })).status).toBe(401);
    });

    it('permet de révoquer un autre appareil, pas celui d’un autre utilisateur', async () => {
        const { user, api } = await createUser();
        const other = await anonymous('POST', '/auth/login', { email: user.email, password: PASSWORD });
        const sessions = (await api('GET', '/auth/sessions')).body;
        const target = sessions.find((s: any) => !s.current);
        expect((await api('DELETE', `/auth/sessions/${target.id}`)).status).toBe(200);
        expect((await anonymous('POST', '/auth/refresh', { refreshToken: other.body.refreshToken })).status).toBe(401);

        const stranger = await createUser();
        const mine = (await api('GET', '/auth/sessions')).body[0];
        expect((await stranger.api('DELETE', `/auth/sessions/${mine.id}`)).status).toBe(404);
    });

    it('associe le jeton push à un seul appareil', async () => {
        const a = await createUser();
        const b = await createUser();
        const device = '/auth/device';
        await a.api('PUT', device, { fcmToken: 'token-partage', platform: 'android' });
        await b.api('PUT', device, { fcmToken: 'token-partage' });
        expect((await Session.findOne({ where: { userId: a.user.id } }))!.fcmToken).toBeNull();
        expect((await Session.findOne({ where: { userId: b.user.id } }))!.fcmToken).toBe('token-partage');
    });
});

describe('codes de vérification', () => {
    it('vérifie l’email avec le bon code', async () => {
        const email = newEmail();
        const reg = await anonymous('POST', '/auth/register', { username: 'Loan', email, password: PASSWORD });
        const post = (code: string) =>
            app.request('/api/v1/auth/verify-email', {
                method: 'POST',
                headers: { Authorization: `Bearer ${reg.body.accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ code }),
            });

        const code = mail.codes.get(`verify:${email}`)!;
        const wrong = code === '000000' ? '000001' : '000000';
        expect((await post(wrong)).status).toBe(400);
        const ok = await post(code);
        expect(ok.status).toBe(200);
        expect((await ok.json()).emailVerified).toBe(true);
    });

    it('invalide le code après 5 essais ratés', async () => {
        const { user } = await createUser();
        await anonymous('POST', '/auth/forgot-password', { email: user.email });
        const code = mail.codes.get(`reset:${user.email}`)!;
        const wrong = code === '111111' ? '222222' : '111111';
        const reset = (c: string) => anonymous('POST', '/auth/reset-password', { email: user.email, code: c, newPassword: 'nouveau-mot-de-passe' });
        for (let i = 0; i < 5; i++) await reset(wrong);
        // Le bon code ne passe plus : il a été grillé par les essais ratés (ou le limiteur a pris le relais).
        expect([400, 429]).toContain((await reset(code)).status);
        expect((await anonymous('POST', '/auth/login', { email: user.email, password: 'nouveau-mot-de-passe' })).status).toBe(401);
    });

    it('réinitialise le mot de passe et ferme toutes les sessions', async () => {
        const { user, refreshToken } = await createUser();
        const unknown = await anonymous('POST', '/auth/forgot-password', { email: newEmail() });
        const known = await anonymous('POST', '/auth/forgot-password', { email: user.email });
        // Même réponse que le compte existe ou non.
        expect(unknown.body).toEqual(known.body);

        const code = mail.codes.get(`reset:${user.email}`)!;
        const res = await anonymous('POST', '/auth/reset-password', { email: user.email, code, newPassword: 'un-autre-secret' });
        expect(res.status).toBe(200);
        expect((await anonymous('POST', '/auth/refresh', { refreshToken })).status).toBe(401);
        expect((await anonymous('POST', '/auth/login', { email: user.email, password: 'un-autre-secret' })).status).toBe(200);
        // Le code ne sert qu'une fois.
        expect((await anonymous('POST', '/auth/reset-password', { email: user.email, code, newPassword: 'encore-un-autre' })).status).toBe(400);
    });
});

describe('profil', () => {
    it('fusionne les réglages au lieu de les écraser', async () => {
        const { api } = await createUser();
        await api('PATCH', '/auth/me', { settings: { monthStartDay: 25 } });
        const res = await api('PATCH', '/auth/me', {
            settings: { skipNote: true },
            notificationPrefs: { quietHoursStart: '22:00', quietHoursEnd: '07:00' },
        });
        expect(res.body.settings).toMatchObject({ monthStartDay: 25, skipNote: true, currency: 'EUR' });
        expect(res.body.notificationPrefs).toMatchObject({ quietHoursStart: '22:00', lowBalance: true });
    });

    it('ignore les champs sensibles dans la mise à jour du profil', async () => {
        const { api, user } = await createUser();
        await api('PATCH', '/auth/me', { email: 'pirate@moneo.test', passwordHash: 'x', emailVerifiedAt: null, username: 'Nouveau nom' });
        const fresh = await User.findByPk(user.id);
        expect(fresh!.email).toBe(user.email);
        expect(fresh!.emailVerifiedAt).not.toBeNull();
        expect(fresh!.username).toBe('Nouveau nom');
    });

    it('change le mot de passe et déconnecte les autres appareils', async () => {
        const { api, user } = await createUser();
        const other = await anonymous('POST', '/auth/login', { email: user.email, password: PASSWORD });
        const change = '/auth/change-password';
        expect((await api('POST', change, { currentPassword: 'faux', newPassword: 'tout-nouveau-secret' })).status).toBe(400);
        expect((await api('POST', change, { currentPassword: PASSWORD, newPassword: 'tout-nouveau-secret' })).status).toBe(200);
        expect((await anonymous('POST', '/auth/refresh', { refreshToken: other.body.refreshToken })).status).toBe(401);
        expect((await api('GET', '/auth/me')).status).toBe(200);
    });

    it('supprime le compte et toutes ses données après confirmation du mot de passe', async () => {
        const { api, user } = await createUser();
        const account = await createAccount(api);
        await api('POST', '/transactions', { accountId: account.id, type: 'expense', amount: 10 });

        expect((await api('DELETE', '/auth/me', { password: 'faux' })).status).toBe(400);
        expect((await api('DELETE', '/auth/me', { password: PASSWORD })).status).toBe(200);
        expect(await User.findByPk(user.id)).toBeNull();
        expect(await Transaction.count({ where: { userId: user.id }, paranoid: false })).toBe(0);
        expect(await Session.count({ where: { userId: user.id } })).toBe(0);
    });
});
