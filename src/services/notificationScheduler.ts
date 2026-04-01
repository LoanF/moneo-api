import cron from 'node-cron';
import { Op, fn, col } from 'sequelize';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import { sendPushNotification } from './fcmService.js';
import { logger } from '../utils/logger.js';

const MONTH_NAMES = [
    'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'
];

// ── Récap mensuel — 1er du mois à 8h00 ───────────────────────────────────────
cron.schedule('0 8 1 * *', async () => {
    logger.info('[Scheduler] Démarrage récap mensuel');

    const now = new Date();
    const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
    const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const start = new Date(prevYear, prevMonth, 1);
    const end = new Date(prevYear, prevMonth + 1, 0, 23, 59, 59);

    const users = await User.findAll({
        where: { fcmToken: { [Op.ne]: null } }
    });

    for (const user of users) {
        try {
            const totals = await Transaction.findAll({
                where: {
                    userId: user.uid,
                    date: { [Op.between]: [start, end] },
                    type: { [Op.ne]: 'transfer' }
                },
                attributes: ['type', [fn('sum', col('amount')), 'total']],
                group: ['type']
            });

            let income = 0, expense = 0;
            totals.forEach((t: any) => {
                if (t.type === 'income') income = Number(t.get('total'));
                if (t.type === 'expense') expense = Number(t.get('total'));
            });

            if (income === 0 && expense === 0) continue;
            if (user.notificationPrefs?.monthlyRecap === false) continue;

            const net = income - expense;
            const sign = net >= 0 ? '+' : '';

            await sendPushNotification(
                user.fcmToken!,
                `Récap ${MONTH_NAMES[prevMonth]}`,
                `Revenus ${income.toFixed(0)} € · Dépenses ${expense.toFixed(0)} € · Bilan ${sign}${net.toFixed(0)} €`
            );
        } catch (err) {
            logger.error({ err, userId: user.uid }, '[Scheduler] Erreur récap mensuel');
        }
    }

    logger.info('[Scheduler] Récap mensuel terminé');
});

// ── Rappel de saisie — tous les jours à 9h00 si aucune transaction depuis 5 jours ──
cron.schedule('0 9 * * *', async () => {
    logger.info('[Scheduler] Démarrage rappel de saisie');

    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    const users = await User.findAll({
        where: {
            fcmToken: { [Op.ne]: null },
            hasCompletedSetup: true
        }
    });

    for (const user of users) {
        try {
            const recent = await Transaction.findOne({
                where: {
                    userId: user.uid,
                    date: { [Op.gte]: fiveDaysAgo }
                }
            });

            if (!recent && user.notificationPrefs?.activityReminder !== false) {
                await sendPushNotification(
                    user.fcmToken!,
                    "N'oubliez pas vos transactions",
                    'Aucune opération saisie depuis 5 jours. Gardez votre budget à jour !'
                );
            }
        } catch (err) {
            logger.error({ err, userId: user.uid }, '[Scheduler] Erreur rappel de saisie');
        }
    }

    logger.info('[Scheduler] Rappel de saisie terminé');
});
