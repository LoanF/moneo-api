import { QueryTypes, type Transaction as Tx } from 'sequelize';
import { BankAccount, sequelize } from '../db/models.js';
import { todayISO } from '../lib/dates.js';
import { toNumber } from '../lib/money.js';

export type AccountBalances = {
    /** Solde restant : solde initial + toutes les écritures, y compris celles à venir. */
    balance: number;
    /** Solde pointé : solde initial + écritures pointées. */
    pointedBalance: number;
    /** Solde à ce jour : solde initial + écritures datées d'aujourd'hui ou avant. */
    todayBalance: number;
    /** Total des crédits non pointés. */
    uncheckedCredit: number;
    /** Total des débits non pointés (valeur positive). */
    uncheckedDebit: number;
    uncheckedCount: number;
    transactionCount: number;
};

type Row = {
    id: string;
    balance: string;
    pointed_balance: string;
    today_balance: string;
    unchecked_credit: string;
    unchecked_debit: string;
    unchecked_count: string;
    transaction_count: string;
};

/**
 * Les soldes ne sont jamais stockés : ils se déduisent du solde initial et des écritures,
 * exactement comme les formules SOMME.SI du classeur. Impossible, donc, qu'ils dérivent.
 */
export const computeBalances = async (userId: string, transaction?: Tx): Promise<Map<string, AccountBalances>> => {
    const rows = await sequelize.query<Row>(
        `SELECT a.id,
                a.initial_balance + COALESCE(SUM(t.amount), 0) AS balance,
                a.initial_balance + COALESCE(SUM(t.amount) FILTER (WHERE t.is_checked), 0) AS pointed_balance,
                a.initial_balance + COALESCE(SUM(t.amount) FILTER (WHERE t.date <= :today), 0) AS today_balance,
                COALESCE(SUM(t.amount) FILTER (WHERE NOT t.is_checked AND t.amount > 0), 0) AS unchecked_credit,
                COALESCE(-SUM(t.amount) FILTER (WHERE NOT t.is_checked AND t.amount < 0), 0) AS unchecked_debit,
                COUNT(t.id) FILTER (WHERE NOT t.is_checked) AS unchecked_count,
                COUNT(t.id) AS transaction_count
           FROM bank_accounts a
           LEFT JOIN transactions t ON t.account_id = a.id AND t.deleted_at IS NULL
          WHERE a.user_id = :userId
          GROUP BY a.id`,
        { replacements: { userId, today: todayISO() }, type: QueryTypes.SELECT, transaction },
    );
    return new Map(
        rows.map((r) => [
            r.id,
            {
                balance: toNumber(r.balance),
                pointedBalance: toNumber(r.pointed_balance),
                todayBalance: toNumber(r.today_balance),
                uncheckedCredit: toNumber(r.unchecked_credit),
                uncheckedDebit: toNumber(r.unchecked_debit),
                uncheckedCount: Number(r.unchecked_count),
                transactionCount: Number(r.transaction_count),
            },
        ]),
    );
};

const EMPTY = (initial: number): AccountBalances => ({
    balance: initial,
    pointedBalance: initial,
    todayBalance: initial,
    uncheckedCredit: 0,
    uncheckedDebit: 0,
    uncheckedCount: 0,
    transactionCount: 0,
});

export const serializeAccount = (account: BankAccount, balances?: AccountBalances) => ({
    id: account.id,
    name: account.name,
    type: account.type,
    initialBalance: account.initialBalance,
    currency: account.currency,
    sortOrder: account.sortOrder,
    iconCode: account.iconCode,
    colorValue: account.colorValue,
    lowBalanceThreshold: account.lowBalanceThreshold,
    includeInTotal: account.includeInTotal,
    archived: account.archivedAt !== null,
    ...(balances ?? EMPTY(account.initialBalance)),
});

export const listAccountsWithBalances = async (userId: string) => {
    const [accounts, balances] = await Promise.all([
        BankAccount.findAll({ where: { userId }, order: [['sortOrder', 'ASC'], ['createdAt', 'ASC']] }),
        computeBalances(userId),
    ]);
    return accounts.map((a) => serializeAccount(a, balances.get(a.id)));
};
