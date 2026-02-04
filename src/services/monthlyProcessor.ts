import cron from 'node-cron';
import { Op } from 'sequelize';
import MonthlyPayment from '../models/MonthlyPayment.js';
import Transaction from '../models/Transaction.js';
import BankAccount from '../models/BankAccount.js';
import sequelize from '../config/database.js';

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
            await Transaction.create({
                userId: payment.userId,
                accountId: payment.accountId,
                categoryId: payment.categoryId,
                paymentMethodId: payment.paymentMethodId,
                amount: payment.amount,
                type: payment.type,
                note: `[Automatique] ${payment.name}`,
                date: today,
                isChecked: true
            }, { transaction: t });

            const account = await BankAccount.findByPk(payment.accountId, { transaction: t });
            if (account) {
                const adjustment = payment.type === 'income' ? Number(payment.amount) : -Number(payment.amount);
                account.balance = Number(account.balance) + adjustment;
                await account.save({ transaction: t });
            }

            payment.lastProcessed = today;
            await payment.save({ transaction: t });

            await t.commit();
            console.log(`✅ Opération mensuelle traitée : ${payment.name} pour l'user ${payment.userId}`);
        } catch (error) {
            await t.rollback();
            console.error(`❌ Échec opération mensuelle ${payment.name}:`, error);
        }
    }
};

// Planification : S'exécute tous les jours à 00:01
cron.schedule('1 0 * * *', processMonthlyPayments);