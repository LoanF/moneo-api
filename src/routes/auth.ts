import { randomUUID } from 'node:crypto';
import { createRoute, z } from '@hono/zod-openapi';
import { Op, UniqueConstraintError } from 'sequelize';
import { env } from '../config/env.js';
import { Session, User, sequelize } from '../db/models.js';
import { badRequest, conflict, notFound, unauthorized } from '../lib/errors.js';
import { publish } from '../lib/events.js';
import { IdParam, SuccessSchema, body, createRouter, errors, json, secured, type AppContext } from '../lib/http.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { authMiddleware } from '../middleware/auth.js';
import { RateLimit, clientIp, rateLimit, tooManyRequests } from '../middleware/rateLimiter.js';
import {
    consumeCode,
    createSession,
    issueCode,
    revokeAllSessions,
    revokeSession,
    rotateSession,
    serializeUser,
    setPassword,
    updateDevice,
    type DeviceMeta,
} from '../services/auth.js';
import { sendPasswordResetEmail, sendVerificationEmail } from '../services/mailer.js';
import { seedUserDefaults } from '../services/seed.js';

// ── Schémas ──────────────────────────────────────────────────────────────────

const Email = z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email('Adresse email invalide').max(255));
const Password = z
    .string()
    .min(8, 'Le mot de passe doit contenir au moins 8 caractères')
    .max(128, 'Le mot de passe ne peut pas dépasser 128 caractères');
const Code = z.string().regex(/^\d{6}$/, 'Le code doit contenir 6 chiffres');
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure invalide (HH:MM)');

const DeviceSchema = z.object({
    fcmToken: z.string().max(4096).nullish(),
    deviceName: z.string().max(120).nullish(),
    platform: z.string().max(30).nullish(),
});

const SettingsSchema = z
    .object({
        currency: z.string().length(3).toUpperCase(),
        monthStartDay: z.number().int().min(1).max(28),
        defaultAccountId: z.uuid().nullable(),
        skipNote: z.boolean(),
        trackingStartDate: z.iso.date().nullable(),
        recurringMode: z.enum(['month_start', 'due_date', 'manual']),
        lowBalanceThreshold: z.number().nullable(),
    })
    .openapi('UserSettings');

const NotificationPrefsSchema = z
    .object({
        paymentApplied: z.boolean(),
        lowBalance: z.boolean(),
        monthlyRecap: z.boolean(),
        activityReminder: z.boolean(),
        budgetAlert: z.boolean(),
        upcomingPayment: z.boolean(),
        quietHoursStart: HHMM.nullable(),
        quietHoursEnd: HHMM.nullable(),
    })
    .openapi('NotificationPrefs');

const UserSchema = z
    .object({
        id: z.uuid(),
        username: z.string(),
        email: z.string(),
        photoUrl: z.string().nullable(),
        hasCompletedSetup: z.boolean(),
        emailVerified: z.boolean(),
        hasPassword: z.boolean(),
        settings: SettingsSchema,
        notificationPrefs: NotificationPrefsSchema,
    })
    .openapi('User');

const TokensSchema = z
    .object({ accessToken: z.string(), refreshToken: z.string(), expiresIn: z.number() })
    .openapi('Tokens');
const AuthResponseSchema = TokensSchema.extend({ user: UserSchema }).openapi('AuthResponse');

const SessionSchema = z
    .object({
        id: z.uuid(),
        deviceName: z.string().nullable(),
        platform: z.string().nullable(),
        ip: z.string().nullable(),
        lastUsedAt: z.string(),
        createdAt: z.string(),
        current: z.boolean(),
        pushEnabled: z.boolean(),
    })
    .openapi('Session');

// ── Limiteurs ────────────────────────────────────────────────────────────────

const MIN15 = 15 * 60 * 1000;
/** Limite par compte visé : freine le bourrage d'identifiants distribué sur plusieurs IP. */
const loginByEmail = new RateLimit(10, MIN15);
const resetByEmail = new RateLimit(5, MIN15);
const forgotByEmail = new RateLimit(3, MIN15);
const resendByUser = new RateLimit(3, MIN15);
const verifyByUser = new RateLimit(10, MIN15);

/** Hash factice : égalise le temps de réponse quand l'email n'existe pas. */
const DUMMY_HASH = hashPassword(randomUUID());

const deviceMeta = (c: AppContext, device: z.infer<typeof DeviceSchema> = {}): DeviceMeta => ({
    ip: clientIp(c),
    userAgent: c.req.header('user-agent') ?? null,
    deviceName: device.deviceName ?? null,
    platform: device.platform ?? null,
    fcmToken: device.fcmToken ?? null,
});

const requireUser = async (userId: string): Promise<User> => {
    const user = await User.findByPk(userId);
    if (!user) throw unauthorized('Compte introuvable', 'account_deleted');
    return user;
};

const auth = createRouter();
const tag = ['Authentification'];

// ── Routes publiques ─────────────────────────────────────────────────────────

auth.use('/register', rateLimit(5, 10 * 60 * 1000));
auth.use('/login', rateLimit(30, MIN15));
auth.use('/google', rateLimit(20, 60 * 1000));
auth.use('/refresh', rateLimit(60, 60 * 1000));
auth.use('/forgot-password', rateLimit(10, MIN15));
auth.use('/reset-password', rateLimit(20, MIN15));

auth.openapi(
    createRoute({
        method: 'post',
        path: '/register',
        tags: tag,
        summary: 'Créer un compte',
        request: body(
            z.object({ username: z.string().trim().min(2, 'Le nom doit contenir au moins 2 caractères').max(60), email: Email, password: Password })
                .extend(DeviceSchema.shape)
                .openapi('RegisterInput'),
        ),
        responses: { 201: json(AuthResponseSchema, 'Compte créé'), ...errors },
    }),
    async (c) => {
        const input = c.req.valid('json');
        try {
            const { user, tokens, code } = await sequelize.transaction(async (transaction) => {
                const user = await User.create(
                    { username: input.username, email: input.email, passwordHash: await hashPassword(input.password) },
                    { transaction },
                );
                await seedUserDefaults(user.id, transaction);
                const code = await issueCode(user.id, 'email_verify', transaction);
                const tokens = await createSession(user, deviceMeta(c, input), transaction);
                return { user, tokens, code };
            });
            sendVerificationEmail(user.email, code);
            return c.json({ ...tokens, user: serializeUser(user) }, 201);
        } catch (error) {
            if (error instanceof UniqueConstraintError) throw conflict('Un compte existe déjà avec cet email');
            throw error;
        }
    },
);

auth.openapi(
    createRoute({
        method: 'post',
        path: '/login',
        tags: tag,
        summary: 'Se connecter par email et mot de passe',
        request: body(z.object({ email: Email, password: z.string().max(128) }).extend(DeviceSchema.shape).openapi('LoginInput')),
        responses: { 200: json(AuthResponseSchema), ...errors },
    }),
    async (c) => {
        const input = c.req.valid('json');
        const limit = loginByEmail.hit(input.email);
        if (!limit.ok) return tooManyRequests(c, limit.retryAfter) as never;

        const user = await User.findOne({ where: { email: input.email } });
        const valid = await verifyPassword(input.password, user?.passwordHash ?? (await DUMMY_HASH));
        if (!user || !user.passwordHash || !valid) throw unauthorized('Email ou mot de passe incorrect', 'invalid_credentials');

        loginByEmail.reset(input.email);
        const tokens = await createSession(user, deviceMeta(c, input));
        return c.json({ ...tokens, user: serializeUser(user) }, 200);
    },
);

let googleClient: import('google-auth-library').OAuth2Client | null = null;

auth.openapi(
    createRoute({
        method: 'post',
        path: '/google',
        tags: tag,
        summary: 'Se connecter avec Google',
        request: body(z.object({ idToken: z.string().min(1) }).extend(DeviceSchema.shape).openapi('GoogleInput')),
        responses: { 200: json(AuthResponseSchema), ...errors },
    }),
    async (c) => {
        const input = c.req.valid('json');
        if (!env.GOOGLE_CLIENT_ID) throw badRequest('Connexion Google non configurée');

        let payload;
        try {
            if (!googleClient) {
                const { OAuth2Client } = await import('google-auth-library');
                googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);
            }
            const ticket = await googleClient.verifyIdToken({ idToken: input.idToken, audience: env.GOOGLE_CLIENT_ID });
            payload = ticket.getPayload();
        } catch {
            throw unauthorized('Authentification Google refusée', 'invalid_google_token');
        }
        if (!payload?.email || !payload.email_verified) throw unauthorized('Authentification Google refusée', 'invalid_google_token');
        const email = payload.email.toLowerCase();

        const user = await sequelize.transaction(async (transaction) => {
            const existing = await User.findOne({
                where: { [Op.or]: [{ googleId: payload.sub }, { email }] },
                transaction,
            });
            if (!existing) {
                const created = await User.create(
                    {
                        username: (payload.name || email.split('@')[0]).slice(0, 60),
                        email,
                        googleId: payload.sub,
                        photoUrl: payload.picture ?? null,
                        emailVerifiedAt: new Date(),
                    },
                    { transaction },
                );
                await seedUserDefaults(created.id, transaction);
                return created;
            }
            // Un compte créé par mot de passe mais jamais vérifié n'a pas prouvé qu'il possède
            // l'adresse : on invalide ce mot de passe pour qu'un tiers ne garde pas l'accès.
            if (existing.emailVerifiedAt === null && existing.passwordHash !== null) {
                existing.passwordHash = null;
                await revokeAllSessions(existing.id, undefined, transaction);
            }
            existing.googleId ??= payload.sub;
            existing.photoUrl ??= payload.picture ?? null;
            existing.emailVerifiedAt ??= new Date();
            await existing.save({ transaction });
            return existing;
        });

        const tokens = await createSession(user, deviceMeta(c, input));
        return c.json({ ...tokens, user: serializeUser(user) }, 200);
    },
);

auth.openapi(
    createRoute({
        method: 'post',
        path: '/refresh',
        tags: tag,
        summary: 'Renouveler les jetons (rotation du refresh token)',
        request: body(z.object({ refreshToken: z.string().min(1).max(256) }).openapi('RefreshInput')),
        responses: { 200: json(TokensSchema), ...errors },
    }),
    async (c) => {
        const { refreshToken } = c.req.valid('json');
        return c.json(await rotateSession(refreshToken, deviceMeta(c)), 200);
    },
);

auth.openapi(
    createRoute({
        method: 'post',
        path: '/forgot-password',
        tags: tag,
        summary: 'Demander un code de réinitialisation',
        request: body(z.object({ email: Email }).openapi('ForgotPasswordInput')),
        responses: { 200: json(SuccessSchema), ...errors },
    }),
    async (c) => {
        const { email } = c.req.valid('json');
        // Réponse identique que le compte existe ou non : pas d'énumération d'adresses.
        if (forgotByEmail.hit(email).ok) {
            const user = await User.findOne({ where: { email } });
            if (user) sendPasswordResetEmail(user.email, await issueCode(user.id, 'password_reset'));
        }
        return c.json({ success: true }, 200);
    },
);

auth.openapi(
    createRoute({
        method: 'post',
        path: '/reset-password',
        tags: tag,
        summary: 'Choisir un nouveau mot de passe avec le code reçu',
        request: body(z.object({ email: Email, code: Code, newPassword: Password }).openapi('ResetPasswordInput')),
        responses: { 200: json(SuccessSchema), ...errors },
    }),
    async (c) => {
        const { email, code, newPassword } = c.req.valid('json');
        const limit = resetByEmail.hit(email);
        if (!limit.ok) return tooManyRequests(c, limit.retryAfter) as never;

        const user = await User.findOne({ where: { email } });
        if (!user || !(await consumeCode(user.id, 'password_reset', code))) {
            throw badRequest('Code invalide ou expiré', 'invalid_code');
        }
        await sequelize.transaction(async (transaction) => {
            // Recevoir le code prouve la possession de l'adresse.
            user.emailVerifiedAt ??= new Date();
            await setPassword(user, newPassword, transaction);
            await revokeAllSessions(user.id, undefined, transaction);
        });
        resetByEmail.reset(email);
        return c.json({ success: true }, 200);
    },
);

// ── Routes authentifiées ─────────────────────────────────────────────────────

const me = createRouter();
me.use('*', authMiddleware);

me.openapi(
    createRoute({ method: 'get', path: '/me', tags: tag, summary: 'Profil courant', security: secured, responses: { 200: json(UserSchema), ...errors } }),
    async (c) => c.json(serializeUser(await requireUser(c.get('auth').userId)), 200),
);

me.openapi(
    createRoute({
        method: 'patch',
        path: '/me',
        tags: tag,
        summary: 'Modifier le profil, les réglages et les préférences de notification',
        security: secured,
        request: body(
            z.object({
                username: z.string().trim().min(2).max(60).optional(),
                hasCompletedSetup: z.boolean().optional(),
                settings: SettingsSchema.partial().optional(),
                notificationPrefs: NotificationPrefsSchema.partial().optional(),
            }).openapi('UpdateProfileInput'),
        ),
        responses: { 200: json(UserSchema), ...errors },
    }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        const input = c.req.valid('json');
        const user = await requireUser(userId);

        if (input.username !== undefined) user.username = input.username;
        if (input.hasCompletedSetup !== undefined) user.hasCompletedSetup = input.hasCompletedSetup;
        // Fusion clé par clé : un client qui n'envoie qu'un réglage ne doit pas effacer les autres.
        if (input.settings) user.settings = { ...user.settings, ...input.settings };
        if (input.notificationPrefs) user.notificationPrefs = { ...user.notificationPrefs, ...input.notificationPrefs };
        await user.save();

        publish(userId, { model: 'user', type: 'updated', id: userId, origin: sessionId });
        return c.json(serializeUser(user), 200);
    },
);

me.openapi(
    createRoute({
        method: 'delete',
        path: '/me',
        tags: tag,
        summary: 'Supprimer définitivement le compte et toutes ses données',
        security: secured,
        request: body(
            z.object({
                password: z.string().max(128).optional(),
                confirmEmail: z.string().optional(),
            }).openapi('DeleteAccountInput'),
        ),
        responses: { 200: json(SuccessSchema), ...errors },
    }),
    async (c) => {
        const { userId } = c.get('auth');
        const { password, confirmEmail } = c.req.valid('json');
        const user = await requireUser(userId);

        if (user.passwordHash) {
            if (!password || !(await verifyPassword(password, user.passwordHash))) {
                throw badRequest('Mot de passe incorrect', 'invalid_credentials');
            }
        } else if (confirmEmail?.trim().toLowerCase() !== user.email) {
            throw badRequest('Saisissez votre adresse email pour confirmer', 'confirmation_required');
        }
        // Les clés étrangères en ON DELETE CASCADE emportent toutes les données liées.
        await user.destroy();
        return c.json({ success: true }, 200);
    },
);

me.openapi(
    createRoute({
        method: 'post',
        path: '/change-password',
        tags: tag,
        summary: 'Changer (ou définir) le mot de passe',
        security: secured,
        request: body(z.object({ currentPassword: z.string().max(128).optional(), newPassword: Password }).openapi('ChangePasswordInput')),
        responses: { 200: json(SuccessSchema), ...errors },
    }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        const { currentPassword, newPassword } = c.req.valid('json');
        const user = await requireUser(userId);

        if (user.passwordHash && !(await verifyPassword(currentPassword ?? '', user.passwordHash))) {
            throw badRequest('Mot de passe actuel incorrect', 'invalid_credentials');
        }
        await sequelize.transaction(async (transaction) => {
            await setPassword(user, newPassword, transaction);
            await revokeAllSessions(userId, sessionId, transaction);
        });
        return c.json({ success: true }, 200);
    },
);

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

me.openapi(
    createRoute({
        method: 'post',
        path: '/me/avatar',
        tags: tag,
        summary: 'Envoyer une photo de profil (JPEG, PNG ou WebP, 2 Mo max)',
        security: secured,
        request: { body: { content: { 'multipart/form-data': { schema: z.object({ avatar: z.any() }) } } } },
        responses: { 200: json(UserSchema), ...errors },
    }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        const form = await c.req.parseBody();
        const file = form['avatar'];
        if (!(file instanceof File)) throw badRequest('Aucun fichier fourni');
        const extension = AVATAR_TYPES[file.type];
        if (!extension) throw badRequest('Format non pris en charge (JPEG, PNG ou WebP)');
        if (file.size > MAX_AVATAR_BYTES) throw badRequest('Image trop lourde (2 Mo maximum)');
        if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET_NAME || !env.R2_PUBLIC_URL) {
            throw badRequest('Le stockage des images n’est pas configuré sur ce serveur');
        }

        const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = new S3Client({
            region: 'auto',
            endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
            credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
        });
        // Le nom fourni par le client n'est jamais réutilisé dans la clé.
        const key = `avatars/${userId}/${randomUUID()}.${extension}`;
        await s3.send(
            new PutObjectCommand({
                Bucket: env.R2_BUCKET_NAME,
                Key: key,
                Body: Buffer.from(await file.arrayBuffer()),
                ContentType: file.type,
                CacheControl: 'public, max-age=31536000, immutable',
            }),
        );

        const user = await requireUser(userId);
        user.photoUrl = `${env.R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`;
        await user.save();
        publish(userId, { model: 'user', type: 'updated', id: userId, origin: sessionId });
        return c.json(serializeUser(user), 200);
    },
);

me.openapi(
    createRoute({ method: 'delete', path: '/me/avatar', tags: tag, summary: 'Retirer la photo de profil', security: secured, responses: { 200: json(UserSchema), ...errors } }),
    async (c) => {
        const user = await requireUser(c.get('auth').userId);
        user.photoUrl = null;
        await user.save();
        return c.json(serializeUser(user), 200);
    },
);

me.openapi(
    createRoute({
        method: 'post',
        path: '/verify-email',
        tags: tag,
        summary: 'Valider l’adresse email avec le code reçu',
        security: secured,
        request: body(z.object({ code: Code }).openapi('VerifyEmailInput')),
        responses: { 200: json(UserSchema), ...errors },
    }),
    async (c) => {
        const { userId } = c.get('auth');
        const user = await requireUser(userId);
        if (user.emailVerifiedAt === null) {
            const limit = verifyByUser.hit(userId);
            if (!limit.ok) return tooManyRequests(c, limit.retryAfter) as never;
            if (!(await consumeCode(userId, 'email_verify', c.req.valid('json').code))) {
                throw badRequest('Code invalide ou expiré', 'invalid_code');
            }
            user.emailVerifiedAt = new Date();
            await user.save();
        }
        return c.json(serializeUser(user), 200);
    },
);

me.openapi(
    createRoute({ method: 'post', path: '/resend-verification', tags: tag, summary: 'Renvoyer le code de vérification', security: secured, responses: { 200: json(SuccessSchema), ...errors } }),
    async (c) => {
        const { userId } = c.get('auth');
        const user = await requireUser(userId);
        if (user.emailVerifiedAt !== null) throw badRequest('Adresse déjà vérifiée');
        const limit = resendByUser.hit(userId);
        if (!limit.ok) return tooManyRequests(c, limit.retryAfter) as never;
        sendVerificationEmail(user.email, await issueCode(userId, 'email_verify'));
        return c.json({ success: true }, 200);
    },
);

me.openapi(
    createRoute({ method: 'post', path: '/logout', tags: tag, summary: 'Fermer la session courante', security: secured, responses: { 200: json(SuccessSchema), ...errors } }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        await revokeSession(userId, sessionId);
        return c.json({ success: true }, 200);
    },
);

me.openapi(
    createRoute({ method: 'post', path: '/logout-all', tags: tag, summary: 'Fermer toutes les autres sessions', security: secured, responses: { 200: json(SuccessSchema), ...errors } }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        await revokeAllSessions(userId, sessionId);
        return c.json({ success: true }, 200);
    },
);

me.openapi(
    createRoute({ method: 'get', path: '/sessions', tags: tag, summary: 'Appareils connectés', security: secured, responses: { 200: json(SessionSchema.array()), ...errors } }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        const sessions = await Session.findAll({
            where: { userId, revokedAt: null, expiresAt: { [Op.gt]: new Date() } },
            order: [['lastUsedAt', 'DESC']],
        });
        return c.json(
            sessions.map((s) => ({
                id: s.id,
                deviceName: s.deviceName,
                platform: s.platform,
                ip: s.ip,
                lastUsedAt: s.lastUsedAt.toISOString(),
                createdAt: s.createdAt.toISOString(),
                current: s.id === sessionId,
                pushEnabled: s.fcmToken !== null,
            })),
            200,
        );
    },
);

me.openapi(
    createRoute({ method: 'delete', path: '/sessions/{id}', tags: tag, summary: 'Révoquer un appareil', security: secured, request: { params: IdParam }, responses: { 200: json(SuccessSchema), ...errors } }),
    async (c) => {
        if (!(await revokeSession(c.get('auth').userId, c.req.valid('param').id))) throw notFound('Session introuvable');
        return c.json({ success: true }, 200);
    },
);

me.openapi(
    createRoute({
        method: 'put',
        path: '/device',
        tags: tag,
        summary: 'Enregistrer le jeton push et le nom de l’appareil courant',
        security: secured,
        request: body(DeviceSchema.openapi('DeviceInput')),
        responses: { 200: json(SuccessSchema), ...errors },
    }),
    async (c) => {
        const { userId, sessionId } = c.get('auth');
        const input = c.req.valid('json');
        await updateDevice(userId, sessionId, {
            ...(input.fcmToken !== undefined ? { fcmToken: input.fcmToken } : {}),
            ...(input.deviceName !== undefined ? { deviceName: input.deviceName } : {}),
            ...(input.platform !== undefined ? { platform: input.platform } : {}),
        });
        return c.json({ success: true }, 200);
    },
);

auth.route('/', me);

export default auth;
