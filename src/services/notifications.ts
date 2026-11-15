import { Op, QueryTypes, UniqueConstraintError } from 'sequelize';
import { BankAccount, Budget, Category, Notification, Session, User, sequelize, type NotificationPrefs } from '../db/models.js';
import { budgetPeriod, localTime, todayISO } from '../lib/dates.js';
import { publish } from '../lib/events.js';
import { logger } from '../lib/logger.js';
import { round2, toNumber } from '../lib/money.js';
import { DEFAULT_NOTIFICATION_PREFS, DEFAULT_SETTINGS } from './auth.js';
import { sendPush } from './push.js';

export type NotificationType =
    | 'payment_applied'
    | 'recurring_pending'
    | 'low_balance'
    | 'budget_alert'
    | 'upcoming_payment'
    | 'monthly_recap'
    | 'activity_reminder';

const PREF_BY_TYPE: Record<NotificationType, keyof NotificationPrefs> = {
    payment_applied: 'paymentApplied',
    recurring_pending: 'paymentApplied',
    low_balance: 'lowBalance',
    budget_alert: 'budgetAlert',
    upcoming_payment: 'upcomingPayment',
    monthly_recap: 'monthlyRecap',
    activity_reminder: 'activityReminder',
};

export const euros = (value: number): string =>
    new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value);

/** `true` si l'heure locale tombe dans la plage de silence (qui peut enjamber minuit). */
export const inQuietHours = (prefs: NotificationPrefs, time: string = localTime()): boolean => {
    const { quietHoursStart: start, quietHoursEnd: end } = prefs;
    if (!start || !end || start === end) return false;
    return start < end ? time >= start && time < end : time >= start || time < end;
};

export type NotifyInput = {
    type: NotificationType;
    title: string;
    body: string;
    data?: Record<string, string>;
    /** Deux notifications portant la même clé ne sont créées qu'une fois. */
    dedupKey?: string;
};

/**
 * Crée une notification dans l'app et la pousse sur les appareils de l'utilisateur.
 * Ne lève jamais : une notification ratée ne doit pas faire échouer l'opération métier.
 */
export const notify = async (userId: string, input: NotifyInput): Promise<boolean> => {
    try {
        const user = await User.findByPk(userId);
        if (!user) return false;
        const prefs = { ...DEFAULT_NOTIFICATION_PREFS, ...user.notificationPrefs };
        if (prefs[PREF_BY_TYPE[input.type]] === false) return false;

        if (input.dedupKey) {
            const existing = await Notification.count({ where: { userId, dedupKey: input.dedupKey } });
            if (existing > 0) return false;
        }
        let notification: Notification;
        try {
            notification = await Notification.create({
                userId,
                type: input.type,
                title: input.title,
                body: input.body,
                data: input.data ?? null,
                dedupKey: input.dedupKey ?? null,
            });
        } catch (err) {
            // Course sur la clé de déduplication : une autre requête l'a déjà créée.
            if (err instanceof UniqueConstraintError) return false;
            throw err;
        }
        publish(userId, { model: 'notification', type: 'created', id: notification.id });

        if (!inQuietHours(prefs)) {
            const sessions = await Session.findAll({
                where: { userId, revokedAt: null, fcmToken: { [Op.ne]: null }, expiresAt: { [Op.gt]: new Date() } },
            });
            const tokens = sessions.map((s) => s.fcmToken as string);
            const dead = await sendPush(tokens, input.title, input.body, {
                ...input.data,
                type: input.type,
                notificationId: notification.id,
            });
            if (dead.length > 0) await Session.update({ fcmToken: null }, { where: { fcmToken: { [Op.in]: dead } } });
        }
        return true;
    } catch (err) {
        logger.error({ err, type: input.type }, '[Notifications] Échec de la notification');
        return false;
    }
};

/** Alerte quand le solde à ce jour d'un compte passe sous son seuil (une fois par jour et par compte). */
export const checkLowBalance = async (userId: string, accountId: string): Promise<void> => {
    try {
        const [account, user] = await Promise.all([BankAccount.findOne({ where: { id: accountId, userId } }), User.findByPk(userId)]);
        if (!account || !user || account.archivedAt) return;
        const threshold = account.lowBalanceThreshold ?? { ...DEFAULT_SETTINGS, ...user.settings }.lowBalanceThreshold;
        if (threshold === null || threshold === undefined) return;

        const today = todayISO();
        const [row] = await sequelize.query<{ balance: string }>(
            `SELECT a.initial_balance + COALESCE(SUM(t.amount), 0) AS balance
               FROM bank_accounts a
               LEFT JOIN transactions t ON t.account_id = a.id AND t.deleted_at IS NULL AND t.date <= :today
              WHERE a.id = :accountId
              GROUP BY a.id`,
            { replacements: { accountId, today }, type: QueryTypes.SELECT },
        );
        const balance = toNumber(row?.balance);
        if (balance >= threshold) return;

        await notify(userId, {
            type: 'low_balance',
            title: `Solde bas — ${account.name}`,
            body: `Le solde est de ${euros(balance)}, sous votre seuil de ${euros(threshold)}.`,
            data: { accountId },
            dedupKey: `low_balance:${accountId}:${today}`,
        });
    } catch (err) {
        logger.error({ err }, '[Notifications] Vérification du solde bas impossible');
    }
};

/** Dépenses de la période pour une catégorie (sous-catégories incluses) ou pour tout le budget. */
export const spentInPeriod = async (userId: string, categoryId: string | null, from: string, to: string): Promise<number> => {
    const [row] = await sequelize.query<{ spent: string }>(
        `SELECT COALESCE(-SUM(t.amount), 0) AS spent
           FROM transactions t
           LEFT JOIN categories c ON c.id = t.category_id
          WHERE t.user_id = :userId AND t.deleted_at IS NULL AND t.type = 'expense'
            AND t.date BETWEEN :from AND :to
            AND (:categoryId::uuid IS NULL OR t.category_id = :categoryId::uuid OR c.parent_id = :categoryId::uuid)`,
        { replacements: { userId, categoryId, from, to }, type: QueryTypes.SELECT },
    );
    return toNumber(row?.spent);
};

/** Alerte à l'approche (seuil du budget) puis au dépassement, une fois par période et par palier. */
export const checkBudgets = async (userId: string, categoryId: string | null): Promise<void> => {
    try {
        const user = await User.findByPk(userId);
        if (!user) return;
        const category = categoryId ? await Category.findOne({ where: { id: categoryId, userId } }) : null;
        const categoryIds = [categoryId, category?.parentId ?? null].filter((id): id is string => id !== null);

        const budgets = await Budget.findAll({
            where: { userId, [Op.or]: [{ categoryId: null }, ...(categoryIds.length ? [{ categoryId: { [Op.in]: categoryIds } }] : [])] },
        });
        if (budgets.length === 0) return;

        const startDay = { ...DEFAULT_SETTINGS, ...user.settings }.monthStartDay;
        const { from, to } = budgetPeriod(todayISO(), startDay);

        for (const budget of budgets) {
            const spent = await spentInPeriod(userId, budget.categoryId, from, to);
            const percent = round2((spent / budget.amount) * 100);
            const level = percent >= 100 ? 100 : percent >= budget.alertThreshold ? budget.alertThreshold : 0;
            if (level === 0) continue;

            const label = budget.categoryId
                ? ((await Category.findByPk(budget.categoryId))?.name ?? 'Catégorie')
                : 'Budget global';
            await notify(userId, {
                type: 'budget_alert',
                title: level >= 100 ? `Budget dépassé — ${label}` : `Budget bientôt atteint — ${label}`,
                body: `${euros(spent)} dépensés sur ${euros(budget.amount)} (${Math.round(percent)} %).`,
                data: { budgetId: budget.id },
                dedupKey: `budget:${budget.id}:${from}:${level >= 100 ? 'over' : 'near'}`,
            });
        }
    } catch (err) {
        logger.error({ err }, '[Notifications] Vérification des budgets impossible');
    }
};
