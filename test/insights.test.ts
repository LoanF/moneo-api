import { describe, expect, it } from 'vitest';
import { Notification, RecurringPayment, Transaction } from '../src/db/models.js';
import { addDays, addMonths, clampDay, periodOf, todayISO } from '../src/lib/dates.js';
import { sendMonthlyRecaps } from '../src/services/jobs.js';
import { inQuietHours } from '../src/services/notifications.js';
import { amountForPeriod, generateForUser, notifyUpcomingPayments, pendingForUser, processAllRecurring } from '../src/services/recurring.js';
import { settleSideEffects } from '../src/services/transactions.js';
import { balanceOf, createAccount, createUser } from './helpers.js';

const TX = '/transactions';
const RP = '/recurring-payments';

describe('mensualités', () => {
    it('applique le montant du mois quand une exception existe, et saute les mois à zéro', () => {
        const payment = { amount: 85.38, monthlyAmounts: { '12': 85.41, '8': 0 } };
        expect(amountForPeriod(payment, '2026-03')).toBe(85.38);
        expect(amountForPeriod(payment, '2026-12')).toBe(85.41);
        expect(amountForPeriod(payment, '2026-08')).toBe(0);
    });

    it('génère tout le mois d’un coup, non pointé, sans doublon au rejeu', async () => {
        const { api, user } = await createUser();
        const account = await createAccount(api, 'Courant', 1000);
        await api('POST', RP, { accountId: account.id, name: 'Loyer', amount: 350, type: 'expense', dayOfMonth: 5, startPeriod: '2026-11' });
        await api('POST', RP, { accountId: account.id, name: 'Salaire', amount: 1500, type: 'income', dayOfMonth: 28, startPeriod: '2026-11' });

        const first = await generateForUser(user.id, { today: '2026-11-14' });
        expect(first).toEqual({ created: 2, total: 1150 });
        const again = await generateForUser(user.id, { today: '2026-11-14' });
        expect(again.created).toBe(0);

        const rows = await Transaction.findAll({ where: { userId: user.id }, order: [['date', 'ASC']] });
        expect(rows.map((r) => [r.date, r.amount, r.isChecked, r.source])).toEqual([
            ['2026-11-05', -350, false, 'recurring'],
            ['2026-11-28', 1500, false, 'recurring'],
        ]);
    });

    it('rattrape les mois manqués avec les montants propres à chaque mois', async () => {
        const { api, user } = await createUser();
        const account = await createAccount(api);
        await api('POST', RP, {
            accountId: account.id,
            name: 'Assurance',
            amount: 85.38,
            type: 'expense',
            dayOfMonth: 31,
            startPeriod: '2026-09',
            monthlyAmounts: { '11': 90, '10': 0 },
        });
        const result = await generateForUser(user.id, { today: '2026-12-02' });
        expect(result.created).toBe(3);

        const rows = await Transaction.findAll({ where: { userId: user.id }, order: [['date', 'ASC']] });
        // Septembre et novembre n'ont que 30 jours ; octobre est sauté (montant à zéro).
        expect(rows.map((r) => [r.date, r.amount])).toEqual([
            ['2026-09-30', -85.38],
            ['2026-11-30', -90],
            ['2026-12-31', -85.38],
        ]);
        expect((await RecurringPayment.findOne({ where: { userId: user.id } }))!.lastGeneratedPeriod).toBe('2026-12');
    });

    it('en mode « à l’échéance », ne génère que les échéances atteintes', async () => {
        const { api, user } = await createUser({ settings: { recurringMode: 'due_date' } });
        const account = await createAccount(api);
        await api('POST', RP, { accountId: account.id, name: 'Internet', amount: 39.99, type: 'expense', dayOfMonth: 20, startPeriod: '2026-11' });

        expect((await generateForUser(user.id, { today: '2026-11-14' })).created).toBe(0);
        expect((await generateForUser(user.id, { today: '2026-11-20' })).created).toBe(1);
        expect((await generateForUser(user.id, { today: '2026-11-25' })).created).toBe(0);
    });

    it('une opération générée puis supprimée n’est pas recréée', async () => {
        const { api, user } = await createUser();
        const account = await createAccount(api);
        await api('POST', RP, { accountId: account.id, name: 'Deezer', amount: 5.99, type: 'expense', dayOfMonth: 5, startPeriod: '2026-11' });
        await generateForUser(user.id, { today: '2026-11-14' });
        const [row] = await Transaction.findAll({ where: { userId: user.id } });
        await api('DELETE', `${TX}/${row.id}`);
        expect((await generateForUser(user.id, { today: '2026-11-20' })).created).toBe(0);
    });

    it('en mode manuel, liste les échéances en attente et les passe à la demande', async () => {
        const { api, user } = await createUser({ settings: { recurringMode: 'manual' } });
        const account = await createAccount(api, 'Courant', 100);
        const period = periodOf(todayISO());
        await api('POST', RP, { accountId: account.id, name: 'Eau', amount: 36, type: 'expense', dayOfMonth: 21, startPeriod: period });

        expect(await pendingForUser(user.id)).toHaveLength(1);
        expect((await api('GET', `${RP}/pending`)).body[0]).toMatchObject({ name: 'Eau', amount: 36, date: clampDay(period, 21) });
        expect((await api('GET', '/bootstrap')).body.pendingRecurring).toBe(1);

        // La tâche quotidienne ne génère rien mais prévient l'utilisateur, une seule fois.
        await processAllRecurring(todayISO(), [user.id]);
        await processAllRecurring(todayISO(), [user.id]);
        expect(await Transaction.count({ where: { userId: user.id } })).toBe(0);
        expect(await Notification.count({ where: { userId: user.id, type: 'recurring_pending' } })).toBe(1);

        expect((await api('POST', `${RP}/run`)).body).toEqual({ created: 1, total: -36 });
        expect((await balanceOf(api, account.id)).balance).toBe(64);
        expect((await api('GET', `${RP}/pending`)).body).toHaveLength(0);
    });

    it('par défaut, démarre ce mois-ci si l’échéance n’est pas passée, sinon le mois suivant', async () => {
        const { api } = await createUser();
        const account = await createAccount(api);
        const today = todayISO();
        const period = periodOf(today);
        const res = await api('POST', RP, { accountId: account.id, name: 'Test', amount: 1, type: 'expense', dayOfMonth: 15 });
        expect(res.body.startPeriod).toBe(clampDay(period, 15) >= today ? period : addMonths(period, 1));
    });

    it('refuse une mensualité sur le compte d’un autre et valide les mois', async () => {
        const alice = await createUser();
        const bob = await createUser();
        const account = await createAccount(alice.api);
        const mine = await createAccount(bob.api);
        expect((await bob.api('POST', RP, { accountId: account.id, name: 'X', amount: 1, type: 'expense', dayOfMonth: 1 })).status).toBe(404);
        const bad = await bob.api('POST', RP, { accountId: mine.id, name: 'X', amount: 1, type: 'expense', dayOfMonth: 1, monthlyAmounts: { '13': 5 } });
        expect(bad.status).toBe(400);
    });

    it('prévient la veille des prélèvements', async () => {
        const { api, user } = await createUser();
        const account = await createAccount(api);
        const tomorrow = addDays(todayISO(), 1);
        await api('POST', RP, {
            accountId: account.id,
            name: 'Gaz',
            amount: 101.86,
            type: 'expense',
            dayOfMonth: Number(tomorrow.slice(8, 10)),
            startPeriod: periodOf(tomorrow),
        });
        await notifyUpcomingPayments();
        await notifyUpcomingPayments();
        const notes = await Notification.findAll({ where: { userId: user.id, type: 'upcoming_payment' } });
        expect(notes).toHaveLength(1);
        expect(notes[0].body).toContain('101,86');
    });
});

describe('statistiques', () => {
    const seed = async () => {
        const { api, user } = await createUser();
        const account = await createAccount(api, 'Courant', 1000);
        const savings = await createAccount(api, 'Livret', 5000);
        const categories = (await api('GET', '/categories')).body as any[];
        const root = (name: string) => categories.find((c) => c.name === name && !c.parentId);
        const sub = (parent: string, name: string) => categories.find((c) => c.parentId === root(parent).id && c.name === name);
        const mk = (o: object) => api('POST', TX, { accountId: account.id, type: 'expense', ...o });

        await mk({ amount: 350, date: '2026-03-05', categoryId: sub('Logement', 'Loyer').id });
        await mk({ amount: 50, date: '2026-03-05', categoryId: sub('Logement', 'Électricité').id });
        await mk({ amount: 20, date: '2026-03-10', categoryId: root('Restaurant').id });
        await mk({ amount: 10, date: '2026-03-12' });
        await mk({ amount: 1500, date: '2026-03-28', type: 'income', categoryId: sub('Revenus', 'Salaire').id });
        await mk({ amount: 80, date: '2026-04-02', categoryId: root('Restaurant').id });
        await api('POST', `${TX}/transfers`, { fromAccountId: account.id, toAccountId: savings.id, amount: 200, date: '2026-03-15' });
        return { api, user, account, savings, root, sub };
    };

    it('synthétise une période et cumule les sous-catégories dans leur catégorie', async () => {
        const { api, root } = await seed();
        const res = await api('GET', '/stats/summary?from=2026-03-01&to=2026-03-31');
        expect(res.body).toMatchObject({ income: 1500, expense: 430, net: 1070, transactionCount: 5 });
        expect(res.body.savingsRate).toBeCloseTo(71.33, 2);
        expect(res.body.largestExpense.amount).toBe(350);

        const housing = res.body.expensesByCategory[0];
        expect(housing).toMatchObject({ categoryId: root('Logement').id, total: 400, count: 2 });
        expect(housing.subcategories.map((s: any) => [s.name, s.total])).toEqual([['Loyer', 350], ['Électricité', 50]]);
        expect(res.body.expensesByCategory.at(-1)).toMatchObject({ categoryId: null, name: 'Sans catégorie', total: 10 });
        // Les transferts ne sont ni un revenu ni une dépense.
        expect(res.body.expensesByCategory.reduce((n: number, c: any) => n + c.total, 0)).toBe(430);
    });

    it('restreint la synthèse à un compte', async () => {
        const { api, savings } = await seed();
        const res = await api('GET', `/stats/summary?from=2026-03-01&to=2026-03-31&accountId=${savings.id}`);
        expect(res.body).toMatchObject({ income: 0, expense: 0 });
    });

    it('reconstitue l’historique quotidien du solde, transferts neutres sur le total', async () => {
        const { api, account } = await seed();
        const all = await api('GET', '/stats/balance-history?from=2026-03-01&to=2026-03-31');
        expect(all.body.openingBalance).toBe(6000);
        expect(all.body.points).toHaveLength(31);
        expect(all.body.points.find((p: any) => p.date === '2026-03-05').balance).toBe(5600);
        expect(all.body.points.find((p: any) => p.date === '2026-03-15').balance).toBe(5570);
        expect(all.body.points.at(-1).balance).toBe(7070);

        const one = await api('GET', `/stats/balance-history?from=2026-03-01&to=2026-03-31&accountId=${account.id}`);
        expect(one.body.points.find((p: any) => p.date === '2026-03-15').balance).toBe(370);
    });

    it('produit le tableau croisé période → catégorie → sous-catégorie', async () => {
        const { api } = await seed();
        const res = await api('GET', '/stats/pivot?from=2026-03-01&to=2026-04-30&granularity=month');
        expect(res.body.rows.map((r: any) => r.key)).toEqual(['2026-04', '2026-03']);
        const march = res.body.rows[1];
        expect(march).toMatchObject({ debit: 630, credit: 1700 });
        const housing = march.categories.find((c: any) => c.name === 'Logement');
        expect(housing).toMatchObject({ debit: 400, credit: 0 });
        expect(housing.subcategories.map((s: any) => s.name).sort()).toEqual(['Loyer', 'Électricité']);
        // Comme dans le classeur, les transferts apparaissent sous « Transfert », ventilés par compte.
        const transfer = march.categories.find((c: any) => c.name === 'Transfert');
        expect(transfer).toMatchObject({ debit: 200, credit: 200 });
        expect(transfer.subcategories.map((s: any) => s.name).sort()).toEqual(['Courant', 'Livret']);
        expect(res.body.totals).toEqual({ debit: 710, credit: 1700 });

        const daily = await api('GET', '/stats/pivot?from=2026-03-05&to=2026-03-05&granularity=day');
        expect(daily.body.rows).toHaveLength(1);
        expect(daily.body.rows[0]).toMatchObject({ key: '2026-03-05', debit: 400 });
    });

    it('renvoie les totaux mois par mois, mois vides compris', async () => {
        const { api } = await createUser();
        const res = await api('GET', '/stats/monthly?months=3');
        expect(res.body).toHaveLength(3);
        expect(res.body.at(-1)).toMatchObject({ period: periodOf(todayISO()), income: 0, expense: 0, net: 0 });
    });

    it('projette le solde avec les écritures futures et les mensualités à venir', async () => {
        const { api } = await createUser({ settings: { recurringMode: 'due_date' } });
        const account = await createAccount(api, 'Courant', 1000);
        const today = todayISO();
        const inFive = addDays(today, 5);
        await api('POST', TX, { accountId: account.id, type: 'expense', amount: 100, date: addDays(today, 2) });
        await api('POST', RP, {
            accountId: account.id,
            name: 'Loyer',
            amount: 350,
            type: 'expense',
            dayOfMonth: Number(inFive.slice(8, 10)),
            startPeriod: periodOf(inFive),
        });

        const res = await api('GET', '/stats/forecast?days=10');
        expect(res.body.currentBalance).toBe(1000);
        expect(res.body.projectedBalance).toBe(550);
        expect(res.body.lowest).toEqual({ date: inFive, balance: 550 });
        expect(res.body.upcoming).toEqual([expect.objectContaining({ name: 'Loyer', amount: -350, date: inFive })]);
        expect(res.body.points).toHaveLength(11);
    });
});

describe('budgets et alertes', () => {
    it('suit l’avancement d’un budget de catégorie et alerte une fois par palier', async () => {
        const { api, user } = await createUser();
        const account = await createAccount(api, 'Courant', 5000);
        const categories = (await api('GET', '/categories')).body as any[];
        const root = categories.find((c) => c.name === 'Restaurant');
        const sub = categories.find((c) => c.parentId === root.id);

        const created = await api('POST', '/budgets', { categoryId: root.id, amount: 100 });
        expect(created.status).toBe(201);
        expect((await api('POST', '/budgets', { categoryId: root.id, amount: 50 })).status).toBe(409);

        await api('POST', TX, { accountId: account.id, type: 'expense', amount: 50, categoryId: sub.id });
        await settleSideEffects();
        expect(await Notification.count({ where: { userId: user.id, type: 'budget_alert' } })).toBe(0);

        await api('POST', TX, { accountId: account.id, type: 'expense', amount: 35, categoryId: root.id });
        await api('POST', TX, { accountId: account.id, type: 'expense', amount: 1, categoryId: root.id });
        await settleSideEffects();
        expect(await Notification.count({ where: { userId: user.id, type: 'budget_alert' } })).toBe(1);

        await api('POST', TX, { accountId: account.id, type: 'expense', amount: 30, categoryId: sub.id });
        await settleSideEffects();
        const alerts = await Notification.findAll({ where: { userId: user.id, type: 'budget_alert' }, order: [['createdAt', 'ASC']] });
        expect(alerts.map((a) => a.title)).toEqual(['Budget bientôt atteint — Restaurant', 'Budget dépassé — Restaurant']);

        const [budget] = (await api('GET', '/budgets')).body;
        expect(budget).toMatchObject({ amount: 100, spent: 116, remaining: -16, percent: 116 });
        expect(budget.projected).toBeGreaterThanOrEqual(116);
    });

    it('alerte sur un solde bas, une fois par jour, et respecte les préférences', async () => {
        const { api, user } = await createUser();
        const account = await createAccount(api, 'Courant', 150);
        await api('PATCH', `/accounts/${account.id}`, { lowBalanceThreshold: 100 });
        await api('POST', TX, { accountId: account.id, type: 'expense', amount: 60 });
        await api('POST', TX, { accountId: account.id, type: 'expense', amount: 5 });
        await settleSideEffects();
        const alerts = await Notification.findAll({ where: { userId: user.id, type: 'low_balance' } });
        expect(alerts).toHaveLength(1);
        expect(alerts[0].title).toBe('Solde bas — Courant');

        const quiet = await createUser({ notificationPrefs: { lowBalance: false } });
        const other = await createAccount(quiet.api, 'Courant', 10);
        await quiet.api('POST', TX, { accountId: other.id, type: 'expense', amount: 60 });
        await settleSideEffects();
        expect(await Notification.count({ where: { userId: quiet.user.id } })).toBe(0);
    });

    it('gère le centre de notifications', async () => {
        const { api, user } = await createUser();
        const account = await createAccount(api, 'Courant', 50);
        await api('POST', TX, { accountId: account.id, type: 'expense', amount: 10 });
        await settleSideEffects();

        const list = await api('GET', '/notifications');
        expect(list.body.unreadCount).toBe(1);
        expect(list.body.items[0]).toMatchObject({ type: 'low_balance', read: false });
        expect((await api('POST', '/notifications/read', {})).body.unreadCount).toBe(0);

        const stranger = await createUser();
        expect((await stranger.api('DELETE', `/notifications/${list.body.items[0].id}`)).status).toBe(404);
        expect((await api('DELETE', '/notifications')).status).toBe(200);
        expect(await Notification.count({ where: { userId: user.id } })).toBe(0);
    });

    it('envoie le récapitulatif du mois écoulé une seule fois', async () => {
        const { api, user } = await createUser();
        const account = await createAccount(api);
        await api('POST', TX, { accountId: account.id, type: 'income', amount: 1500, date: '2026-10-28' });
        await api('POST', TX, { accountId: account.id, type: 'expense', amount: 400, date: '2026-10-05' });
        await sendMonthlyRecaps('2026-11-01');
        await sendMonthlyRecaps('2026-11-01');
        const recaps = await Notification.findAll({ where: { userId: user.id, type: 'monthly_recap' } });
        expect(recaps).toHaveLength(1);
        expect(recaps[0].title).toBe('Votre mois de octobre');
    });

    it('reconnaît les heures calmes, y compris à cheval sur minuit', () => {
        const night = { quietHoursStart: '22:00', quietHoursEnd: '07:00' };
        expect(inQuietHours(night, '23:30')).toBe(true);
        expect(inQuietHours(night, '06:59')).toBe(true);
        expect(inQuietHours(night, '07:00')).toBe(false);
        expect(inQuietHours({ quietHoursStart: '12:00', quietHoursEnd: '14:00' }, '13:00')).toBe(true);
        expect(inQuietHours({}, '03:00')).toBe(false);
    });
});
