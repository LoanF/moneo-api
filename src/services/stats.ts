import { QueryTypes } from 'sequelize';
import { Budget, Category, User, sequelize } from '../db/models.js';
import { addDays, addMonths, budgetPeriod, daysInMonth, diffDays, periodOf, todayISO } from '../lib/dates.js';
import { notFound } from '../lib/errors.js';
import { round2, toNumber } from '../lib/money.js';
import { DEFAULT_SETTINGS } from './auth.js';
import { spentInPeriod } from './notifications.js';
import { upcomingForUser } from './recurring.js';

type Range = { from: string; to: string; accountId?: string };

const select = <T extends object>(sql: string, replacements: Record<string, unknown>) =>
    sequelize.query<T>(sql, { replacements, type: QueryTypes.SELECT });

/** Clause commune : écritures vivantes de l'utilisateur, éventuellement restreintes à un compte. */
const SCOPE = `t.user_id = :userId AND t.deleted_at IS NULL AND (:accountId::uuid IS NULL OR t.account_id = :accountId::uuid)`;
const scope = (userId: string, accountId?: string) => ({ userId, accountId: accountId ?? null });

// ── Synthèse d'une période ───────────────────────────────────────────────────

export const getSummary = async (userId: string, { from, to, accountId }: Range) => {
    const params = { ...scope(userId, accountId), from, to };

    const [totals] = await select<{ income: string; expense: string; count: string }>(
        `SELECT COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'income'), 0) AS income,
                COALESCE(-SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0) AS expense,
                COUNT(*) FILTER (WHERE t.type <> 'transfer') AS count
           FROM transactions t
          WHERE ${SCOPE} AND t.date BETWEEN :from AND :to`,
        params,
    );

    // Chaque sous-catégorie est rattachée à sa catégorie racine pour le cumul.
    const rows = await select<{
        type: 'income' | 'expense';
        root_id: string | null;
        category_id: string | null;
        total: string;
        count: string;
    }>(
        `SELECT t.type, COALESCE(c.parent_id, c.id) AS root_id, c.id AS category_id,
                SUM(ABS(t.amount)) AS total, COUNT(*) AS count
           FROM transactions t
           LEFT JOIN categories c ON c.id = t.category_id
          WHERE ${SCOPE} AND t.date BETWEEN :from AND :to AND t.type <> 'transfer'
          GROUP BY t.type, COALESCE(c.parent_id, c.id), c.id`,
        params,
    );

    const categories = new Map((await Category.findAll({ where: { userId } })).map((c) => [c.id, c]));
    const build = (type: 'income' | 'expense') => {
        const grandTotal = toNumber(type === 'income' ? totals.income : totals.expense);
        const roots = new Map<string, { total: number; count: number; subs: { id: string; name: string; total: number; count: number }[] }>();
        for (const row of rows.filter((r) => r.type === type)) {
            const key = row.root_id ?? '';
            const root = roots.get(key) ?? { total: 0, count: 0, subs: [] };
            root.total = round2(root.total + toNumber(row.total));
            root.count += Number(row.count);
            if (row.category_id && row.category_id !== row.root_id) {
                root.subs.push({
                    id: row.category_id,
                    name: categories.get(row.category_id)?.name ?? 'Sous-catégorie',
                    total: toNumber(row.total),
                    count: Number(row.count),
                });
            }
            roots.set(key, root);
        }
        return [...roots.entries()]
            .map(([id, value]) => {
                const category = categories.get(id);
                return {
                    categoryId: id || null,
                    name: category?.name ?? 'Sans catégorie',
                    iconCode: category?.iconCode ?? null,
                    colorValue: category?.colorValue ?? null,
                    total: value.total,
                    count: value.count,
                    percent: grandTotal > 0 ? round2((value.total / grandTotal) * 100) : 0,
                    subcategories: value.subs.sort((a, b) => b.total - a.total),
                };
            })
            .sort((a, b) => b.total - a.total);
    };

    const byPaymentMethod = await select<{ payment_method_id: string | null; name: string | null; total: string; count: string }>(
        `SELECT t.payment_method_id, p.name, SUM(ABS(t.amount)) AS total, COUNT(*) AS count
           FROM transactions t
           LEFT JOIN payment_methods p ON p.id = t.payment_method_id
          WHERE ${SCOPE} AND t.date BETWEEN :from AND :to AND t.type = 'expense'
          GROUP BY t.payment_method_id, p.name
          ORDER BY total DESC`,
        params,
    );

    const [largest] = await select<{ id: string; note: string | null; amount: string; date: string; category_id: string | null }>(
        `SELECT t.id, t.note, t.amount, t.date::text AS date, t.category_id
           FROM transactions t
          WHERE ${SCOPE} AND t.date BETWEEN :from AND :to AND t.type = 'expense'
          ORDER BY t.amount ASC LIMIT 1`,
        params,
    );

    const income = toNumber(totals.income);
    const expense = toNumber(totals.expense);
    const days = diffDays(from, to) + 1;
    return {
        from,
        to,
        income,
        expense,
        net: round2(income - expense),
        savingsRate: income > 0 ? round2(((income - expense) / income) * 100) : null,
        transactionCount: Number(totals.count),
        averageDailyExpense: days > 0 ? round2(expense / days) : 0,
        largestExpense: largest
            ? { id: largest.id, note: largest.note, amount: Math.abs(toNumber(largest.amount)), date: largest.date, categoryId: largest.category_id }
            : null,
        expensesByCategory: build('expense'),
        incomeByCategory: build('income'),
        expensesByPaymentMethod: byPaymentMethod.map((r) => ({
            paymentMethodId: r.payment_method_id,
            name: r.name ?? 'Non renseigné',
            total: toNumber(r.total),
            count: Number(r.count),
        })),
    };
};

// ── Évolution mensuelle ──────────────────────────────────────────────────────

export const getMonthly = async (userId: string, months: number, accountId?: string, today: string = todayISO()) => {
    const lastPeriod = periodOf(today);
    const firstPeriod = addMonths(lastPeriod, -(months - 1));
    const rows = await select<{ period: string; income: string; expense: string }>(
        `SELECT to_char(t.date, 'YYYY-MM') AS period,
                COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'income'), 0) AS income,
                COALESCE(-SUM(t.amount) FILTER (WHERE t.type = 'expense'), 0) AS expense
           FROM transactions t
          WHERE ${SCOPE} AND t.date >= :from AND t.date <= :to
          GROUP BY 1`,
        { ...scope(userId, accountId), from: `${firstPeriod}-01`, to: `${lastPeriod}-${daysInMonth(lastPeriod)}` },
    );
    const byPeriod = new Map(rows.map((r) => [r.period, r]));
    return Array.from({ length: months }, (_, i) => {
        const period = addMonths(firstPeriod, i);
        const income = toNumber(byPeriod.get(period)?.income);
        const expense = toNumber(byPeriod.get(period)?.expense);
        return { period, income, expense, net: round2(income - expense) };
    });
};

// ── Historique du solde ──────────────────────────────────────────────────────

/** Solde initial cumulé des comptes concernés (un compte précis, ou tous ceux inclus dans le total). */
const openingBalance = async (userId: string, accountId: string | undefined, before: string): Promise<number> => {
    const [row] = await select<{ balance: string | null }>(
        `SELECT SUM(a.initial_balance + COALESCE(x.total, 0)) AS balance
           FROM bank_accounts a
           LEFT JOIN LATERAL (
                SELECT SUM(t.amount) AS total FROM transactions t
                 WHERE t.account_id = a.id AND t.deleted_at IS NULL AND t.date < :before
           ) x ON true
          WHERE a.user_id = :userId
            AND CASE WHEN :accountId::uuid IS NULL THEN a.include_in_total AND a.archived_at IS NULL ELSE a.id = :accountId::uuid END`,
        { ...scope(userId, accountId), before },
    );
    return toNumber(row?.balance);
};

const dailyMovements = async (userId: string, accountId: string | undefined, from: string, to: string) => {
    const rows = await select<{ date: string; total: string }>(
        `SELECT t.date::text AS date, SUM(t.amount) AS total
           FROM transactions t
           JOIN bank_accounts a ON a.id = t.account_id
          WHERE t.user_id = :userId AND t.deleted_at IS NULL AND t.date BETWEEN :from AND :to
            AND CASE WHEN :accountId::uuid IS NULL THEN a.include_in_total AND a.archived_at IS NULL ELSE a.id = :accountId::uuid END
          GROUP BY t.date`,
        { ...scope(userId, accountId), from, to },
    );
    return new Map(rows.map((r) => [r.date, toNumber(r.total)]));
};

export const getBalanceHistory = async (userId: string, { from, to, accountId }: Range) => {
    const [opening, movements] = await Promise.all([openingBalance(userId, accountId, from), dailyMovements(userId, accountId, from, to)]);
    const points: { date: string; balance: number }[] = [];
    let balance = opening;
    for (let date = from; date <= to; date = addDays(date, 1)) {
        balance = round2(balance + (movements.get(date) ?? 0));
        points.push({ date, balance });
    }
    return { from, to, openingBalance: opening, points };
};

// ── Solde prévisionnel ───────────────────────────────────────────────────────

/** Projection : solde à ce jour + écritures déjà datées dans le futur + mensualités à venir. */
export const getForecast = async (userId: string, days: number, accountId?: string, today: string = todayISO()) => {
    const until = addDays(today, days);
    const tomorrow = addDays(today, 1);
    const [start, movements, upcoming] = await Promise.all([
        openingBalance(userId, accountId, tomorrow),
        dailyMovements(userId, accountId, tomorrow, until),
        upcomingForUser(userId, until, today),
    ]);
    const scheduled = upcoming.filter((o) => !accountId || o.accountId === accountId);
    const scheduledByDate = new Map<string, number>();
    for (const o of scheduled) {
        const signed = o.type === 'expense' ? -o.amount : o.amount;
        scheduledByDate.set(o.date, round2((scheduledByDate.get(o.date) ?? 0) + signed));
    }

    const points: { date: string; balance: number }[] = [{ date: today, balance: start }];
    let balance = start;
    let lowest = { date: today, balance: start };
    for (let date = tomorrow; date <= until; date = addDays(date, 1)) {
        balance = round2(balance + (movements.get(date) ?? 0) + (scheduledByDate.get(date) ?? 0));
        points.push({ date, balance });
        if (balance < lowest.balance) lowest = { date, balance };
    }
    return {
        from: today,
        to: until,
        currentBalance: start,
        projectedBalance: balance,
        lowest,
        points,
        upcoming: scheduled.map((o) => ({
            recurringPaymentId: o.paymentId,
            name: o.name,
            date: o.date,
            amount: o.type === 'expense' ? -o.amount : o.amount,
            accountId: o.accountId,
        })),
    };
};

// ── Tableau croisé (feuille « TCD » du classeur) ─────────────────────────────

export type PivotGranularity = 'day' | 'month' | 'year';
const BUCKET: Record<PivotGranularity, string> = { day: 'YYYY-MM-DD', month: 'YYYY-MM', year: 'YYYY' };

type PivotNode = { debit: number; credit: number };
const add = (node: PivotNode, debit: number, credit: number) => {
    node.debit = round2(node.debit + debit);
    node.credit = round2(node.credit + credit);
};

/** Période → catégorie → sous-catégorie, avec sommes des débits et des crédits. Les transferts y figurent. */
export const getPivot = async (userId: string, { from, to, accountId }: Range, granularity: PivotGranularity) => {
    const rows = await select<{
        bucket: string;
        type: string;
        root_id: string | null;
        root_name: string | null;
        sub_id: string | null;
        sub_name: string | null;
        counterpart: string | null;
        debit: string;
        credit: string;
    }>(
        `SELECT to_char(t.date, :format) AS bucket, t.type,
                COALESCE(parent.id, c.id) AS root_id, COALESCE(parent.name, c.name) AS root_name,
                CASE WHEN parent.id IS NULL THEN NULL ELSE c.id END AS sub_id,
                CASE WHEN parent.id IS NULL THEN NULL ELSE c.name END AS sub_name,
                COALESCE(other_account.name, t.counterparty) AS counterpart,
                COALESCE(-SUM(t.amount) FILTER (WHERE t.amount < 0), 0) AS debit,
                COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0) AS credit
           FROM transactions t
           LEFT JOIN categories c ON c.id = t.category_id
           LEFT JOIN categories parent ON parent.id = c.parent_id
           LEFT JOIN transactions pair ON pair.transfer_id = t.transfer_id AND pair.id <> t.id AND pair.deleted_at IS NULL
           LEFT JOIN bank_accounts other_account ON other_account.id = pair.account_id
          WHERE ${SCOPE} AND t.date BETWEEN :from AND :to
          GROUP BY 1, t.type, COALESCE(parent.id, c.id), COALESCE(parent.name, c.name), 5, 6, 7
          ORDER BY 1 DESC`,
        { ...scope(userId, accountId), from, to, format: BUCKET[granularity] },
    );

    type Sub = PivotNode & { id: string | null; name: string };
    type Cat = PivotNode & { id: string | null; name: string; subs: Map<string, Sub> };
    type Bucket = PivotNode & { key: string; cats: Map<string, Cat> };
    const buckets = new Map<string, Bucket>();
    const totals: PivotNode = { debit: 0, credit: 0 };

    for (const row of rows) {
        const debit = toNumber(row.debit);
        const credit = toNumber(row.credit);
        const isTransfer = row.type === 'transfer';
        const catKey = isTransfer ? 'transfer' : (row.root_id ?? 'none');
        const catName = isTransfer ? 'Transfert' : (row.root_name ?? 'Sans catégorie');
        const subKey = isTransfer ? (row.counterpart ?? 'none') : (row.sub_id ?? 'none');
        const subName = isTransfer ? (row.counterpart ?? 'Autre compte') : (row.sub_name ?? '—');

        const bucket = buckets.get(row.bucket) ?? { key: row.bucket, debit: 0, credit: 0, cats: new Map<string, Cat>() };
        const cat = bucket.cats.get(catKey) ?? { id: isTransfer ? null : row.root_id, name: catName, debit: 0, credit: 0, subs: new Map<string, Sub>() };
        const sub = cat.subs.get(subKey) ?? { id: isTransfer ? null : row.sub_id, name: subName, debit: 0, credit: 0 };
        add(sub, debit, credit);
        add(cat, debit, credit);
        add(bucket, debit, credit);
        add(totals, debit, credit);
        cat.subs.set(subKey, sub);
        bucket.cats.set(catKey, cat);
        buckets.set(row.bucket, bucket);
    }

    return {
        from,
        to,
        granularity,
        totals,
        rows: [...buckets.values()].map((b) => ({
            key: b.key,
            debit: b.debit,
            credit: b.credit,
            categories: [...b.cats.values()]
                .map((c) => ({
                    categoryId: c.id,
                    name: c.name,
                    debit: c.debit,
                    credit: c.credit,
                    subcategories: [...c.subs.values()]
                        .filter((s) => s.name !== '—' || c.subs.size > 1)
                        .map((s) => ({ categoryId: s.id, name: s.name, debit: s.debit, credit: s.credit })),
                }))
                .sort((a, b) => b.debit + b.credit - (a.debit + a.credit)),
        })),
    };
};

// ── Budgets ──────────────────────────────────────────────────────────────────

export const getBudgetsProgress = async (userId: string, today: string = todayISO()) => {
    const user = await User.findByPk(userId);
    if (!user) throw notFound();
    const { from, to } = budgetPeriod(today, { ...DEFAULT_SETTINGS, ...user.settings }.monthStartDay);
    const elapsed = diffDays(from, today) + 1;
    const length = diffDays(from, to) + 1;

    const budgets = await Budget.findAll({ where: { userId }, order: [['createdAt', 'ASC']] });
    return Promise.all(
        budgets.map(async (budget) => {
            const spent = await spentInPeriod(userId, budget.categoryId, from, to);
            return {
                id: budget.id,
                categoryId: budget.categoryId,
                amount: budget.amount,
                alertThreshold: budget.alertThreshold,
                periodFrom: from,
                periodTo: to,
                spent,
                remaining: round2(budget.amount - spent),
                percent: round2((spent / budget.amount) * 100),
                /** Dépense projetée en fin de période au rythme actuel. */
                projected: round2((spent / elapsed) * length),
            };
        }),
    );
};
