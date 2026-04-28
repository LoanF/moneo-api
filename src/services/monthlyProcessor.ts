import cron from 'node-cron';
import { Op } from 'sequelize';
import MonthlyPayment from '../models/MonthlyPayment.js';
import Transaction from '../models/Transaction.js';
import BankAccount from '../models/BankAccount.js';
import User from '../models/User.js';
import sequelize from '../config/database.js';
import { logger } from '../utils/logger.js';
import { sendPushNotification } from './fcmService.js';

export const processMonthlyPayments = async () => {
    const today = new Date();
    const currentDay = today.getDate();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();

    const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const isLastDay = currentDay === lastDayOfMonth;

    const pendingPayments = await MonthlyPayment.findAll({
        where: {
            dayOfMonth: isLastDay ? { [Op.gte]: currentDay } : currentDay,
            [Op.or]: [
                { lastProcessed: null },
                { lastProcessed: { [Op.lt]: new Date(currentYear, currentMonth, 1) } }
            ]
        }
    });

    for (const payment of pendingPayments) {
        const t = await sequelize.transaction();
        try {
            const signedAmount = payment.type === 'income' ? Number(payment.amount) : -Number(payment.amount);

            await Transaction.create({
                userId: payment.userId,
                accountId: payment.accountId,
                categoryId: payment.categoryId,
                paymentMethodId: payment.paymentMethodId,
                amount: signedAmount,
                type: payment.type,
                note: `[Automatique] ${payment.name}`,
                date: today,
                isChecked: true
            }, { transaction: t });

            const account = await BankAccount.findByPk(payment.accountId, { transaction: t });
            if (account) {
                account.balance = Number(account.balance) + signedAmount;
                await account.save({ transaction: t });
            }

            payment.lastProcessed = today;
            await payment.save({ transaction: t });

            await t.commit();
            logger.info(`Opération mensuelle traitée : ${payment.name} pour l'user ${payment.userId}`);

            // Notification push
            const user = await User.findByPk(payment.userId);
            if (user?.fcmToken && user.notificationPrefs?.paymentApplied !== false) {
                const sign = payment.type === 'income' ? '+' : '-';
                await sendPushNotification(
                    user.fcmToken,
                    'Paiement automatique appliqué',
                    `${payment.name} — ${sign}${Number(payment.amount).toFixed(2)} €`
                );
            }
        } catch (error) {
            await t.rollback();
            logger.error(error, `Échec opération mensuelle ${payment.name}`);
        }
    }
};

// Planification : S'exécute tous les jours à 00:01
cron.schedule('1 0 * * *', processMonthlyPayments);