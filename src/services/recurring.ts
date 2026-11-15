import { randomUUID } from 'node:crypto';
import { UniqueConstraintError } from 'sequelize';
import { RecurringPayment, Transaction, User, sequelize, type RecurringMode } from '../db/models.js';
import { addDays, addMonths, clampDay, monthNumber, periodOf, todayISO } from '../lib/dates.js';
import { publish } from '../lib/events.js';
import { logger } from '../lib/logger.js';
import { round2 } from '../lib/money.js';
import { DEFAULT_SETTINGS } from './auth.js';
import { euros, notify } from './notifications.js';

/** Au-delà, on considère que la mensualité a été oubliée et on ne rattrape pas tout l'historique. */
const MAX_CATCH_UP_MONTHS = 24;

export const serializeRecurring = (p: RecurringPayment) => ({
    id: p.id,
    accountId: p.accountId,
    categoryId: p.categoryId,
    paymentMethodId: p.paymentMethodId,
    name: p.name,
    amount: p.amount,
    type: p.type,
    dayOfMonth: p.dayOfMonth,
    monthlyAmounts: p.monthlyAmounts ?? {},
    isActive: p.isActive,
    startPeriod: p.startPeriod,
    endPeriod: p.endPeriod,
    lastGeneratedPeriod: p.lastGeneratedPeriod,
});

/** Montant d'un mois donné : l'exception du mois si elle existe, sinon le montant par défaut. `0` = mois sauté. */
export const amountForPeriod = (payment: Pick<RecurringPayment, 'amount' | 'monthlyAmounts'>, period: string): number => {
    const override = payment.monthlyAmounts?.[String(monthNumber(period))];
    return round2(override === undefined || override === null ? payment.amount : Number(override));
};

export type Occurrence = { paymentId: string; period: string; date: string; amount: number; name: string; accountId: string; type: 'income' | 'expense' };

/**
 * Échéances pas encore générées jusqu'à `until` (inclus).
 * `dueOnly` limite aux échéances dont la date est atteinte (mode « à l'échéance »).
 */
export const pendingOccurrences = (
    payment: RecurringPayment,
    today: string,
    options: { dueOnly: boolean; until?: string },
): Occurrence[] => {
    if (!payment.isActive) return [];
    const currentPeriod = periodOf(today);
    const untilPeriod = options.until ? periodOf(options.until) : currentPeriod;
    const earliest = addMonths(currentPeriod, -MAX_CATCH_UP_MONTHS);

    // Sans historique ni date de début, on démarre au mois courant : pas de génération rétroactive surprise.
    let period = payment.lastGeneratedPeriod ? addMonths(payment.lastGeneratedPeriod, 1) : (payment.startPeriod ?? currentPeriod);
    if (payment.startPeriod && period < payment.startPeriod) period = payment.startPeriod;
    if (period < earliest) period = earliest;

    const occurrences: Occurrence[] = [];
    for (; period <= untilPeriod; period = addMonths(period, 1)) {
        if (payment.endPeriod && period > payment.endPeriod) break;
        const date = clampDay(period, payment.dayOfMonth);
        if (options.dueOnly && date > today) break;
        if (options.until && date > options.until) break;
        const amount = amountForPeriod(payment, period);
        occurrences.push({ paymentId: payment.id, period, date, amount, name: payment.name, accountId: payment.accountId, type: payment.type });
    }
    return occurrences;
};

const modeOf = (user: User): RecurringMode => ({ ...DEFAULT_SETTINGS, ...user.settings }).recurringMode;

export type GenerationResult = { created: number; total: number };

/**
 * Met en place les mensualités d'un utilisateur (macro « La_Mensualisation »), avec rattrapage
 * des mois manqués. Rejouable sans risque : `lastGeneratedPeriod` et l'index unique
 * (mensualité, mois) empêchent tout doublon, même si deux exécutions se chevauchent.
 */
export const generateForUser = async (
    userId: string,
    options: { mode?: RecurringMode; today?: string; origin?: string } = {},
): Promise<GenerationResult> => {
    const user = await User.findByPk(userId);
    if (!user) return { created: 0, total: 0 };
    const today = options.today ?? todayISO();
    // En mode manuel, une demande explicite génère tout le mois, comme le bouton du classeur.
    const mode = options.mode ?? modeOf(user);
    const dueOnly = mode === 'due_date';

    const ids = (await RecurringPayment.findAll({ where: { userId, isActive: true }, attributes: ['id'] })).map((p) => p.id);
    let created = 0;
    let total = 0;

    for (const id of ids) {
        try {
            const batch = await sequelize.transaction(async (transaction) => {
                let created = 0;
                let total = 0;
                const payment = await RecurringPayment.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
                if (!payment) return { created, total };
                for (const occurrence of pendingOccurrences(payment, today, { dueOnly })) {
                    if (occurrence.amount > 0) {
                        await Transaction.create(
                            {
                                id: randomUUID(),
                                userId,
                                accountId: payment.accountId,
                                categoryId: payment.categoryId,
                                paymentMethodId: payment.paymentMethodId,
                                amount: payment.type === 'expense' ? -occurrence.amount : occurrence.amount,
                                type: payment.type,
                                date: occurrence.date,
                                note: payment.name,
                                isChecked: false,
                                recurringPaymentId: payment.id,
                                recurringPeriod: occurrence.period,
                                source: 'recurring',
                            },
                            { transaction },
                        );
                        created += 1;
                        total = round2(total + (payment.type === 'expense' ? -occurrence.amount : occurrence.amount));
                    }
                    payment.lastGeneratedPeriod = occurrence.period;
                }
                await payment.save({ transaction });
                return { created, total };
            });
            created += batch.created;
            total = round2(total + batch.total);
        } catch (err) {
            // Une autre exécution a déjà généré ce mois : rien à faire.
            if (!(err instanceof UniqueConstraintError)) logger.error({ err, paymentId: id }, '[Mensualités] Échec de génération');
        }
    }
    if (created > 0) publish(userId, { model: 'transaction', type: 'bulk', origin: options.origin });
    return { created, total };
};

/** Échéances en attente pour l'écran « mensualités à mettre en place » (mode manuel). */
export const pendingForUser = async (userId: string, today: string = todayISO()): Promise<Occurrence[]> => {
    const payments = await RecurringPayment.findAll({ where: { userId, isActive: true } });
    return payments
        .flatMap((p) => pendingOccurrences(p, today, { dueOnly: false }))
        .filter((o) => o.amount > 0)
        .sort((a, b) => a.date.localeCompare(b.date));
};

/** Échéances futures pas encore passées en écriture, pour le solde prévisionnel. */
export const upcomingForUser = async (userId: string, until: string, today: string = todayISO()): Promise<Occurrence[]> => {
    const payments = await RecurringPayment.findAll({ where: { userId, isActive: true } });
    return payments
        .flatMap((p) => pendingOccurrences(p, today, { dueOnly: false, until }))
        .filter((o) => o.amount > 0 && o.date > today)
        .sort((a, b) => a.date.localeCompare(b.date));
};

/** Tâche quotidienne : génération automatique, ou rappel pour les utilisateurs en mode manuel. */
export const processAllRecurring = async (today: string = todayISO(), onlyUserIds?: string[]): Promise<number> => {
    const userIds =
        onlyUserIds ??
        (await RecurringPayment.findAll({ where: { isActive: true }, attributes: ['userId'], group: ['userId'] })).map((p) => p.userId);
    let generated = 0;

    for (const userId of userIds) {
        try {
            const user = await User.findByPk(userId);
            if (!user) continue;
            const mode = modeOf(user);
            const period = periodOf(today);

            if (mode === 'manual') {
                const pending = await pendingForUser(userId, today);
                if (pending.length === 0) continue;
                // Comme le classeur : un premier rappel, puis une relance après le 5 du mois.
                const late = Number(today.slice(8, 10)) > 5;
                await notify(userId, {
                    type: 'recurring_pending',
                    title: late ? 'Mensualités toujours en attente' : 'Mensualités à mettre en place',
                    body: `${pending.length} opération${pending.length > 1 ? 's' : ''} mensuelle${pending.length > 1 ? 's' : ''} à valider pour ce mois.`,
                    data: { route: 'recurring' },
                    dedupKey: `recurring_pending:${period}:${late ? 'late' : 'first'}`,
                });
                continue;
            }

            const result = await generateForUser(userId, { mode, today });
            generated += result.created;
            if (result.created > 0) {
                await notify(userId, {
                    type: 'payment_applied',
                    title: 'Mensualités ajoutées',
                    body: `${result.created} opération${result.created > 1 ? 's' : ''} ajoutée${result.created > 1 ? 's' : ''} (${euros(result.total)}).`,
                    data: { route: 'recurring' },
                });
            }
        } catch (err) {
            logger.error({ err, userId }, '[Mensualités] Traitement utilisateur impossible');
        }
    }
    return generated;
};

/** Rappel la veille d'une échéance. */
export const notifyUpcomingPayments = async (today: string = todayISO()): Promise<void> => {
    const tomorrow = addDays(today, 1);
    const payments = await RecurringPayment.findAll({ where: { isActive: true, type: 'expense' } });
    const byUser = new Map<string, { count: number; total: number }>();
    for (const payment of payments) {
        const period = periodOf(tomorrow);
        if (clampDay(period, payment.dayOfMonth) !== tomorrow) continue;
        if (payment.startPeriod && period < payment.startPeriod) continue;
        if (payment.endPeriod && period > payment.endPeriod) continue;
        const amount = amountForPeriod(payment, period);
        if (amount <= 0) continue;
        const entry = byUser.get(payment.userId) ?? { count: 0, total: 0 };
        byUser.set(payment.userId, { count: entry.count + 1, total: round2(entry.total + amount) });
    }
    for (const [userId, { count, total }] of byUser) {
        await notify(userId, {
            type: 'upcoming_payment',
            title: 'Prélèvements demain',
            body: `${count} échéance${count > 1 ? 's' : ''} pour un total de ${euros(total)}.`,
            data: { route: 'recurring' },
            dedupKey: `upcoming:${tomorrow}`,
        });
    }
};

/** Période de départ par défaut : ce mois-ci si l'échéance n'est pas passée, sinon le mois prochain. */
export const defaultStartPeriod = (dayOfMonth: number, today: string = todayISO()): string => {
    const period = periodOf(today);
    return clampDay(period, dayOfMonth) >= today ? period : addMonths(period, 1);
};
