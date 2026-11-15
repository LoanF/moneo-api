import cron from 'node-cron';
import { Op, QueryTypes } from 'sequelize';
import { env } from '../config/env.js';
import { Notification, Transaction, User, sequelize } from '../db/models.js';
import { addDays, addMonths, daysInMonth, periodOf, todayISO } from '../lib/dates.js';
import { logger } from '../lib/logger.js';
import { toNumber } from '../lib/money.js';
import { purgeExpiredAuthData } from './auth.js';
import { notifyHeartbeat } from './heartbeat.js';
import { euros, notify } from './notifications.js';
import { notifyUpcomingPayments, processAllRecurring } from './recurring.js';

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export const runRecurringJob = async (): Promise<void> => {
    try {
        const generated = await processAllRecurring();
        await notifyHeartbeat('up', `Mensualités traitées : ${generated} écriture(s)`);
    } catch (err) {
        logger.error({ err }, '[Jobs] Mensualités en échec');
        await notifyHeartbeat('down', 'Échec du traitement des mensualités');
    }
};

/** Récapitulatif du mois écoulé, envoyé le 1er. */
export const sendMonthlyRecaps = async (today: string = todayISO()): Promise<void> => {
    const period = addMonths(periodOf(today), -1);
    const rows = await sequelize.query<{ user_id: string; income: string; expense: string }>(
        `SELECT user_id,
                COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0) AS income,
                COALESCE(-SUM(amount) FILTER (WHERE type = 'expense'), 0) AS expense
           FROM transactions
          WHERE deleted_at IS NULL AND type <> 'transfer' AND date BETWEEN :from AND :to
          GROUP BY user_id`,
        { replacements: { from: `${period}-01`, to: `${period}-${daysInMonth(period)}` }, type: QueryTypes.SELECT },
    );
    for (const row of rows) {
        const income = toNumber(row.income);
        const expense = toNumber(row.expense);
        if (income === 0 && expense === 0) continue;
        await notify(row.user_id, {
            type: 'monthly_recap',
            title: `Votre mois de ${MONTHS[Number(period.slice(5)) - 1]}`,
            body: `Revenus ${euros(income)} · Dépenses ${euros(expense)} · Solde ${euros(income - expense)}`,
            data: { route: 'stats', period },
            dedupKey: `recap:${period}`,
        });
    }
};

/** Rappel quand rien n'a été saisi depuis 5 jours (au plus une fois par semaine). */
export const sendActivityReminders = async (today: string = todayISO()): Promise<void> => {
    const since = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const users = await User.findAll({ where: { hasCompletedSetup: true }, attributes: ['id'] });
    for (const user of users) {
        const recent = await Transaction.count({ where: { userId: user.id, createdAt: { [Op.gte]: since } } });
        if (recent > 0) continue;
        const week = Math.floor(Date.parse(`${today}T00:00:00Z`) / (7 * 86_400_000));
        await notify(user.id, {
            type: 'activity_reminder',
            title: 'Vos comptes sont-ils à jour ?',
            body: 'Aucune opération saisie depuis 5 jours.',
            data: { route: 'home' },
            dedupKey: `activity:${week}`,
        });
    }
};

/** Nettoyage : sessions mortes, corbeille des opérations et vieilles notifications. */
export const runMaintenance = async (today: string = todayISO()): Promise<void> => {
    const cutoff = new Date(`${addDays(today, -90)}T00:00:00Z`);
    await purgeExpiredAuthData();
    await Transaction.destroy({ where: { deletedAt: { [Op.lt]: cutoff } }, force: true });
    await Notification.destroy({ where: { createdAt: { [Op.lt]: cutoff } } });
};

const safely = (name: string, job: () => Promise<void>) => async () => {
    try {
        await job();
    } catch (err) {
        logger.error({ err }, `[Jobs] ${name} en échec`);
    }
};

export const startJobs = (): void => {
    const options = { timezone: env.APP_TIMEZONE };
    cron.schedule('5 0 * * *', runRecurringJob, options);
    cron.schedule('30 3 * * *', safely('Maintenance', () => runMaintenance()), options);
    cron.schedule('0 8 * * *', safely('Rappel des échéances', () => notifyUpcomingPayments()), options);
    cron.schedule('5 8 1 * *', safely('Récapitulatif mensuel', () => sendMonthlyRecaps()), options);
    cron.schedule('0 18 * * *', safely('Rappel de saisie', () => sendActivityReminders()), options);
    logger.info('[Jobs] Tâches planifiées démarrées');
};
