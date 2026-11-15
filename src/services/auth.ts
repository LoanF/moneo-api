import { Op, type Transaction as Tx } from 'sequelize';
import { Session, User, VerificationCode, sequelize, type CodePurpose } from '../db/models.js';
import { unauthorized } from '../lib/errors.js';
import { hashPassword } from '../lib/password.js';
import {
    ACCESS_TOKEN_TTL_S,
    REFRESH_GRACE_MS,
    SESSION_TTL_MS,
    buildRefreshToken,
    generateCode,
    safeEqualHex,
    sessionIdFromRefreshToken,
    sha256,
    signAccessToken,
} from '../lib/tokens.js';

export type DeviceMeta = {
    ip?: string | null;
    userAgent?: string | null;
    deviceName?: string | null;
    platform?: string | null;
    fcmToken?: string | null;
};

export type TokenPair = { accessToken: string; refreshToken: string; expiresIn: number };

const MAX_CODE_ATTEMPTS = 5;
const CODE_TTL_MS: Record<CodePurpose, number> = {
    email_verify: 24 * 60 * 60 * 1000,
    password_reset: 15 * 60 * 1000,
};

export const DEFAULT_NOTIFICATION_PREFS = {
    paymentApplied: true,
    lowBalance: true,
    monthlyRecap: true,
    activityReminder: true,
    budgetAlert: true,
    upcomingPayment: true,
    quietHoursStart: null as string | null,
    quietHoursEnd: null as string | null,
};

export const DEFAULT_SETTINGS = {
    currency: 'EUR',
    monthStartDay: 1,
    defaultAccountId: null as string | null,
    skipNote: false,
    trackingStartDate: null as string | null,
    recurringMode: 'month_start' as const,
    lowBalanceThreshold: 100 as number | null,
};

export const serializeUser = (user: User) => ({
    id: user.id,
    username: user.username,
    email: user.email,
    photoUrl: user.photoUrl ?? null,
    hasCompletedSetup: user.hasCompletedSetup,
    emailVerified: user.emailVerifiedAt !== null,
    hasPassword: user.passwordHash !== null,
    settings: { ...DEFAULT_SETTINGS, ...user.settings },
    notificationPrefs: { ...DEFAULT_NOTIFICATION_PREFS, ...user.notificationPrefs },
});

const truncate = (value: string | null | undefined, max: number) => (value ? value.slice(0, max) : null);

/** Un jeton push n'appartient qu'à un appareil : on le retire des autres sessions. */
const claimFcmToken = async (sessionId: string, fcmToken: string, transaction?: Tx) => {
    await Session.update({ fcmToken: null }, { where: { fcmToken, id: { [Op.ne]: sessionId } }, transaction });
};

export const createSession = async (user: User, meta: DeviceMeta = {}, transaction?: Tx): Promise<TokenPair> => {
    const session = Session.build({
        userId: user.id,
        tokenHash: '',
        deviceName: truncate(meta.deviceName, 120),
        platform: truncate(meta.platform, 30),
        fcmToken: meta.fcmToken ?? null,
        ip: truncate(meta.ip, 64),
        userAgent: truncate(meta.userAgent, 255),
        lastUsedAt: new Date(),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });
    const refresh = buildRefreshToken(session.id);
    session.tokenHash = refresh.hash;
    await session.save({ transaction });
    if (meta.fcmToken) await claimFcmToken(session.id, meta.fcmToken, transaction);

    return {
        accessToken: await signAccessToken(user.id, session.id, user.email),
        refreshToken: refresh.token,
        expiresIn: ACCESS_TOKEN_TTL_S,
    };
};

/**
 * Rotation du refresh token avec détection de réutilisation.
 * - jeton courant → nouveau couple de jetons ;
 * - jeton précédent, dans la fenêtre de grâce → nouvelle rotation (réponse perdue, requêtes concurrentes) ;
 * - tout autre jeton rattaché à la session → vol présumé, la session est révoquée.
 */
export const rotateSession = async (refreshToken: string, meta: DeviceMeta = {}): Promise<TokenPair> => {
    const sessionId = sessionIdFromRefreshToken(refreshToken);
    if (!sessionId) throw unauthorized('Session invalide', 'invalid_refresh_token');
    const presented = sha256(refreshToken);

    const outcome = await sequelize.transaction(async (transaction) => {
        const session = await Session.findByPk(sessionId, { transaction, lock: transaction.LOCK.UPDATE });
        if (!session || session.revokedAt || session.expiresAt < new Date()) return null;

        const isCurrent = safeEqualHex(session.tokenHash, presented);
        const inGrace =
            !isCurrent &&
            session.previousTokenHash !== null &&
            safeEqualHex(session.previousTokenHash, presented) &&
            session.rotatedAt !== null &&
            Date.now() - session.rotatedAt.getTime() < REFRESH_GRACE_MS;

        if (!isCurrent && !inGrace) {
            session.revokedAt = new Date();
            await session.save({ transaction });
            return null;
        }

        const user = await User.findByPk(session.userId, { transaction });
        if (!user) return null;

        const next = buildRefreshToken(session.id);
        if (isCurrent) {
            session.previousTokenHash = session.tokenHash;
            session.rotatedAt = new Date();
        }
        session.tokenHash = next.hash;
        session.lastUsedAt = new Date();
        session.expiresAt = new Date(Date.now() + SESSION_TTL_MS);
        if (meta.ip) session.ip = truncate(meta.ip, 64);
        if (meta.userAgent) session.userAgent = truncate(meta.userAgent, 255);
        await session.save({ transaction });

        return { user, session, refreshToken: next.token };
    });

    if (!outcome) throw unauthorized('Session expirée, reconnectez-vous', 'invalid_refresh_token');
    return {
        accessToken: await signAccessToken(outcome.user.id, outcome.session.id, outcome.user.email),
        refreshToken: outcome.refreshToken,
        expiresIn: ACCESS_TOKEN_TTL_S,
    };
};

export const revokeSession = async (userId: string, sessionId: string): Promise<boolean> => {
    const [count] = await Session.update(
        { revokedAt: new Date(), fcmToken: null },
        { where: { id: sessionId, userId, revokedAt: null } },
    );
    return count > 0;
};

export const revokeAllSessions = async (userId: string, exceptSessionId?: string, transaction?: Tx): Promise<void> => {
    await Session.update(
        { revokedAt: new Date(), fcmToken: null },
        {
            where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { [Op.ne]: exceptSessionId } } : {}) },
            transaction,
        },
    );
};

export const updateDevice = async (userId: string, sessionId: string, meta: DeviceMeta): Promise<void> => {
    const session = await Session.findOne({ where: { id: sessionId, userId, revokedAt: null } });
    if (!session) throw unauthorized('Session expirée, reconnectez-vous', 'invalid_session');
    if (meta.fcmToken !== undefined) session.fcmToken = meta.fcmToken;
    if (meta.deviceName !== undefined) session.deviceName = truncate(meta.deviceName, 120);
    if (meta.platform !== undefined) session.platform = truncate(meta.platform, 30);
    await session.save();
    if (meta.fcmToken) await claimFcmToken(session.id, meta.fcmToken);
};

/** Émet un code à 6 chiffres ; les codes précédents du même usage sont invalidés. */
export const issueCode = async (userId: string, purpose: CodePurpose, transaction?: Tx): Promise<string> => {
    await VerificationCode.destroy({ where: { userId, purpose }, transaction });
    const code = generateCode();
    await VerificationCode.create(
        { userId, purpose, codeHash: sha256(`${userId}:${code}`), expiresAt: new Date(Date.now() + CODE_TTL_MS[purpose]) },
        { transaction },
    );
    return code;
};

/** Vérifie et consomme un code. Au-delà de 5 essais ratés, le code est définitivement invalide. */
export const consumeCode = async (userId: string, purpose: CodePurpose, code: string): Promise<boolean> =>
    sequelize.transaction(async (transaction) => {
        const record = await VerificationCode.findOne({
            where: { userId, purpose, consumedAt: null },
            order: [['createdAt', 'DESC']],
            transaction,
            lock: transaction.LOCK.UPDATE,
        });
        if (!record || record.expiresAt < new Date() || record.attempts >= MAX_CODE_ATTEMPTS) return false;

        if (!safeEqualHex(record.codeHash, sha256(`${userId}:${code}`))) {
            record.attempts += 1;
            await record.save({ transaction });
            return false;
        }
        record.consumedAt = new Date();
        await record.save({ transaction });
        return true;
    });

export const setPassword = async (user: User, password: string, transaction?: Tx): Promise<void> => {
    user.passwordHash = await hashPassword(password);
    await user.save({ transaction });
};

/** Supprime les sessions mortes et les codes expirés (tâche quotidienne). */
export const purgeExpiredAuthData = async (): Promise<void> => {
    const now = new Date();
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await Session.destroy({ where: { [Op.or]: [{ expiresAt: { [Op.lt]: now } }, { revokedAt: { [Op.lt]: monthAgo } }] } });
    await VerificationCode.destroy({ where: { expiresAt: { [Op.lt]: now } } });
};
