import { randomUUID } from 'node:crypto';
import { Op, QueryTypes, col, fn, where as sqlWhere, type Transaction as Tx, type WhereOptions } from 'sequelize';
import { BankAccount, Category, Chequebook, PaymentMethod, Transaction, sequelize } from '../db/models.js';
import { isISODate, todayISO } from '../lib/dates.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { publish } from '../lib/events.js';
import { round2, toNumber } from '../lib/money.js';
import { checkBudgets, checkLowBalance } from './notifications.js';

// ── Sérialisation ────────────────────────────────────────────────────────────

export const serializeTransaction = (t: Transaction) => ({
    id: t.id,
    accountId: t.accountId,
    categoryId: t.categoryId,
    paymentMethodId: t.paymentMethodId,
    chequebookId: t.chequebookId,
    chequeNumber: t.chequeNumber,
    amount: t.amount,
    type: t.type,
    date: t.date,
    note: t.note,
    isChecked: t.isChecked,
    transferId: t.transferId,
    counterparty: t.counterparty,
    recurringPaymentId: t.recurringPaymentId,
    source: t.source,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    deletedAt: t.deletedAt ? t.deletedAt.toISOString() : null,
});

// ── Effets de bord asynchrones (alertes) ─────────────────────────────────────

const pending = new Set<Promise<unknown>>();
const background = (task: Promise<unknown>) => {
    pending.add(task);
    void task.finally(() => pending.delete(task));
};
/** Attend la fin des alertes en cours (utilisé par les tests et l'arrêt propre du serveur). */
export const settleSideEffects = async (): Promise<void> => {
    await Promise.allSettled([...pending]);
};

const afterWrite = (userId: string, rows: Transaction[], origin?: string, type: 'created' | 'updated' | 'deleted' = 'updated') => {
    for (const row of rows) publish(userId, { model: 'transaction', type, id: row.id, origin });
    if (type === 'deleted') return;
    for (const accountId of new Set(rows.map((r) => r.accountId))) background(checkLowBalance(userId, accountId));
    for (const row of rows) if (row.type === 'expense') background(checkBudgets(userId, row.categoryId));
};

// ── Garde-fous ───────────────────────────────────────────────────────────────

type Refs = { accountId?: string | null; categoryId?: string | null; paymentMethodId?: string | null };

/** Vérifie que chaque objet référencé appartient bien à l'utilisateur. */
export const assertOwned = async (userId: string, refs: Refs, transaction?: Tx): Promise<void> => {
    const checks: Promise<void>[] = [];
    const check = (label: string, find: Promise<unknown>) =>
        checks.push(
            find.then((row) => {
                if (!row) throw notFound(`${label} introuvable`);
            }),
        );
    if (refs.accountId) check('Compte', BankAccount.findOne({ where: { id: refs.accountId, userId }, transaction }));
    if (refs.categoryId) check('Catégorie', Category.findOne({ where: { id: refs.categoryId, userId }, transaction }));
    if (refs.paymentMethodId) {
        check('Moyen de paiement', PaymentMethod.findOne({ where: { id: refs.paymentMethodId, userId }, transaction }));
    }
    await Promise.all(checks);
};

export const signedAmount = (type: 'income' | 'expense', amount: number): number => {
    const value = round2(Math.abs(amount));
    return type === 'expense' ? -value : value;
};

const resolveDate = (date?: string | null): string => {
    if (!date) return todayISO();
    if (!isISODate(date)) throw badRequest('Date invalide');
    return date;
};

// ── Chéquiers ────────────────────────────────────────────────────────────────

type ChequeRequest = {
    type: string;
    accountId: string;
    paymentMethodId?: string | null;
    chequebookId?: string | null;
    chequeNumber?: string | null;
};

/**
 * Numérotation automatique des chèques (macro « Numéro_de_chèque » du classeur) :
 * un paiement par chèque sans numéro prend le prochain numéro du chéquier actif.
 */
const assignCheque = async (
    userId: string,
    request: ChequeRequest,
    transaction: Tx,
): Promise<{ chequebookId: string | null; chequeNumber: string | null }> => {
    const none = { chequebookId: null, chequeNumber: null };
    if (!request.paymentMethodId) return none;
    const method = await PaymentMethod.findOne({ where: { id: request.paymentMethodId, userId }, transaction });
    if (!method || method.kind !== 'cheque') return none;

    const provided = request.chequeNumber?.trim() || null;
    // Un chèque encaissé vient du chéquier de quelqu'un d'autre : on garde juste son numéro.
    if (request.type !== 'expense') return { chequebookId: null, chequeNumber: provided };

    const lock = transaction.LOCK.UPDATE;
    let book: Chequebook | null = null;
    if (request.chequebookId) {
        book = await Chequebook.findOne({ where: { id: request.chequebookId, userId }, transaction, lock });
        if (!book) throw notFound('Chéquier introuvable');
    } else {
        book =
            (await Chequebook.findOne({
                where: { userId, isActive: true, accountId: request.accountId },
                order: [['createdAt', 'DESC']],
                transaction,
                lock,
            })) ??
            (await Chequebook.findOne({
                where: { userId, isActive: true, accountId: null },
                order: [['createdAt', 'DESC']],
                transaction,
                lock,
            }));
    }
    if (!book) return { chequebookId: null, chequeNumber: provided };

    if (provided) {
        const n = Number(provided);
        if (Number.isInteger(n) && n >= book.nextNumber) {
            book.nextNumber = n + 1;
            await book.save({ transaction });
        }
        return { chequebookId: book.id, chequeNumber: provided };
    }
    const chequeNumber = String(book.nextNumber);
    book.nextNumber += 1;
    await book.save({ transaction });
    return { chequebookId: book.id, chequeNumber };
};

/** Annuler le dernier chèque émis libère son numéro ; un chèque plus ancien ne change rien. */
const releaseCheque = async (row: Transaction, transaction: Tx): Promise<void> => {
    if (!row.chequebookId || !row.chequeNumber) return;
    const book = await Chequebook.findByPk(row.chequebookId, { transaction, lock: transaction.LOCK.UPDATE });
    if (book && Number(row.chequeNumber) === book.nextNumber - 1 && book.nextNumber > 1) {
        book.nextNumber -= 1;
        await book.save({ transaction });
    }
};

// ── Création ─────────────────────────────────────────────────────────────────

export type TransactionInput = {
    id?: string;
    accountId: string;
    type: 'income' | 'expense';
    amount: number;
    date?: string | null;
    note?: string | null;
    categoryId?: string | null;
    paymentMethodId?: string | null;
    chequebookId?: string | null;
    chequeNumber?: string | null;
    isChecked?: boolean;
};

const createInTransaction = async (userId: string, input: TransactionInput, transaction: Tx) => {
    if (input.id) {
        // Idempotence : un client hors-ligne peut rejouer la même création.
        const existing = await Transaction.findByPk(input.id, { paranoid: false, transaction });
        if (existing) {
            if (existing.userId !== userId) throw conflict('Identifiant déjà utilisé');
            return { row: existing, created: false };
        }
    }
    if (!(Math.abs(input.amount) > 0)) throw badRequest('Le montant doit être différent de zéro');
    await assertOwned(userId, input, transaction);
    const cheque = await assignCheque(userId, input, transaction);
    const isChecked = input.isChecked ?? false;

    const row = await Transaction.create(
        {
            id: input.id ?? randomUUID(),
            userId,
            accountId: input.accountId,
            categoryId: input.categoryId ?? null,
            paymentMethodId: input.paymentMethodId ?? null,
            chequebookId: cheque.chequebookId,
            chequeNumber: cheque.chequeNumber,
            amount: signedAmount(input.type, input.amount),
            type: input.type,
            date: resolveDate(input.date),
            note: input.note?.trim() || null,
            isChecked,
            checkedAt: isChecked ? new Date() : null,
        },
        { transaction },
    );
    return { row, created: true };
};

export const createTransaction = async (userId: string, input: TransactionInput, origin?: string) => {
    const result = await sequelize.transaction((transaction) => createInTransaction(userId, input, transaction));
    if (result.created) afterWrite(userId, [result.row], origin, 'created');
    return result;
};

/** Rejeu d'une file hors-ligne : chaque écriture est indépendante, une erreur n'annule pas les autres. */
export const createBatch = async (userId: string, inputs: TransactionInput[], origin?: string) => {
    const results: { id: string | null; status: 'created' | 'exists' | 'error'; error?: string }[] = [];
    for (const input of inputs) {
        try {
            const { row, created } = await createTransaction(userId, input, origin);
            results.push({ id: row.id, status: created ? 'created' : 'exists' });
        } catch (err) {
            results.push({ id: input.id ?? null, status: 'error', error: err instanceof Error ? err.message : 'Erreur' });
        }
    }
    return results;
};

// ── Transferts ───────────────────────────────────────────────────────────────

export type TransferInput = {
    id?: string;
    fromAccountId: string;
    /** Compte de destination suivi. Absent pour un transfert vers un compte externe. */
    toAccountId?: string | null;
    /** Nom du compte externe (non suivi). */
    counterparty?: string | null;
    amount: number;
    date?: string | null;
    note?: string | null;
    categoryId?: string | null;
    isChecked?: boolean;
};

/**
 * Transfert entre deux comptes suivis : deux écritures miroir reliées par `transferId`
 * (équivalent de la ligne inverse créée par la macro « A_la_ligne »).
 */
export const createTransfer = async (userId: string, input: TransferInput, origin?: string) => {
    const amount = round2(Math.abs(input.amount));
    if (!(amount > 0)) throw badRequest('Le montant doit être supérieur à zéro');
    if (!input.toAccountId && !input.counterparty?.trim()) throw badRequest('Indiquez le compte de destination');
    if (input.toAccountId === input.fromAccountId) throw badRequest('Les deux comptes doivent être différents');
    const transferId = input.id ?? randomUUID();

    const result = await sequelize.transaction(async (transaction) => {
        const existing = await Transaction.findAll({ where: { transferId }, paranoid: false, transaction });
        if (existing.length > 0) {
            if (existing.some((t) => t.userId !== userId)) throw conflict('Identifiant déjà utilisé');
            return { rows: existing, created: false };
        }
        await assertOwned(userId, { accountId: input.fromAccountId, categoryId: input.categoryId }, transaction);
        if (input.toAccountId) await assertOwned(userId, { accountId: input.toAccountId }, transaction);

        const isChecked = input.isChecked ?? false;
        const common = {
            userId,
            type: 'transfer' as const,
            date: resolveDate(input.date),
            note: input.note?.trim() || null,
            categoryId: input.categoryId ?? null,
            transferId,
            isChecked,
            checkedAt: isChecked ? new Date() : null,
        };
        const rows = [
            await Transaction.create(
                {
                    ...common,
                    accountId: input.fromAccountId,
                    amount: -amount,
                    counterparty: input.toAccountId ? null : (input.counterparty?.trim() ?? null),
                },
                { transaction },
            ),
        ];
        if (input.toAccountId) {
            rows.push(await Transaction.create({ ...common, accountId: input.toAccountId, amount }, { transaction }));
        }
        return { rows, created: true };
    });
    if (result.created) afterWrite(userId, result.rows, origin, 'created');
    return result;
};

// ── Modification ─────────────────────────────────────────────────────────────

export type TransactionPatch = Partial<Omit<TransactionInput, 'id'>>;

export const updateTransaction = async (userId: string, id: string, patch: TransactionPatch, origin?: string) => {
    const rows = await sequelize.transaction(async (transaction) => {
        const row = await Transaction.findOne({ where: { id, userId }, transaction, lock: transaction.LOCK.UPDATE });
        if (!row) throw notFound('Opération introuvable');
        const touched = [row];

        const setChecked = (target: Transaction, value: boolean) => {
            if (target.isChecked === value) return;
            target.isChecked = value;
            target.checkedAt = value ? new Date() : null;
        };

        if (row.type === 'transfer') {
            const forbidden =
                (patch.accountId !== undefined && patch.accountId !== row.accountId) ||
                patch.type !== undefined ||
                patch.paymentMethodId !== undefined ||
                patch.chequeNumber !== undefined;
            if (forbidden) throw badRequest('Pour changer les comptes d’un transfert, supprimez-le et recréez-le');

            const pair = row.transferId
                ? await Transaction.findOne({
                      where: { transferId: row.transferId, userId, id: { [Op.ne]: row.id } },
                      transaction,
                      lock: transaction.LOCK.UPDATE,
                  })
                : null;
            if (patch.categoryId) await assertOwned(userId, { categoryId: patch.categoryId }, transaction);

            for (const leg of pair ? [row, pair] : [row]) {
                if (patch.amount !== undefined) {
                    const amount = round2(Math.abs(patch.amount));
                    if (!(amount > 0)) throw badRequest('Le montant doit être supérieur à zéro');
                    leg.amount = leg.amount < 0 ? -amount : amount;
                }
                if (patch.date !== undefined) leg.date = resolveDate(patch.date);
                if (patch.note !== undefined) leg.note = patch.note?.trim() || null;
                if (patch.categoryId !== undefined) leg.categoryId = patch.categoryId;
            }
            // Le pointage reste propre à chaque compte : les deux relevés ne se pointent pas ensemble.
            if (patch.isChecked !== undefined) setChecked(row, patch.isChecked);
            await row.save({ transaction });
            if (pair) {
                await pair.save({ transaction });
                touched.push(pair);
            }
            return touched;
        }

        await assertOwned(userId, patch, transaction);
        const type = (patch.type ?? row.type) as 'income' | 'expense';
        const chequeTouched =
            patch.paymentMethodId !== undefined || patch.chequebookId !== undefined || patch.chequeNumber !== undefined;

        if (patch.accountId !== undefined) row.accountId = patch.accountId;
        if (patch.categoryId !== undefined) row.categoryId = patch.categoryId;
        if (patch.date !== undefined) row.date = resolveDate(patch.date);
        if (patch.note !== undefined) row.note = patch.note?.trim() || null;
        if (patch.amount !== undefined || patch.type !== undefined) {
            const amount = patch.amount ?? row.amount;
            if (!(Math.abs(amount) > 0)) throw badRequest('Le montant doit être différent de zéro');
            row.amount = signedAmount(type, amount);
            row.type = type;
        }
        if (patch.isChecked !== undefined) setChecked(row, patch.isChecked);

        if (chequeTouched) {
            const sameMethod = patch.paymentMethodId === undefined || patch.paymentMethodId === row.paymentMethodId;
            const keepNumber = sameMethod && patch.chequeNumber === undefined ? row.chequeNumber : (patch.chequeNumber ?? null);
            await releaseCheque(row, transaction);
            const paymentMethodId = patch.paymentMethodId !== undefined ? patch.paymentMethodId : row.paymentMethodId;
            const cheque = await assignCheque(
                userId,
                {
                    type,
                    accountId: row.accountId,
                    paymentMethodId,
                    chequebookId: patch.chequebookId !== undefined ? patch.chequebookId : sameMethod ? row.chequebookId : null,
                    chequeNumber: keepNumber,
                },
                transaction,
            );
            row.paymentMethodId = paymentMethodId ?? null;
            row.chequebookId = cheque.chequebookId;
            row.chequeNumber = cheque.chequeNumber;
        }
        await row.save({ transaction });
        return touched;
    });
    afterWrite(userId, rows, origin, 'updated');
    return rows[0];
};

// ── Suppression ──────────────────────────────────────────────────────────────

export const deleteTransaction = async (userId: string, id: string, origin?: string): Promise<void> => {
    const rows = await sequelize.transaction(async (transaction) => {
        const row = await Transaction.findOne({ where: { id, userId }, transaction, lock: transaction.LOCK.UPDATE });
        if (!row) throw notFound('Opération introuvable');
        // Un transfert se supprime toujours des deux côtés, retrouvés par leur identifiant commun.
        const legs = row.transferId ? await Transaction.findAll({ where: { transferId: row.transferId, userId }, transaction }) : [row];
        for (const leg of legs) {
            await releaseCheque(leg, transaction);
            await leg.destroy({ transaction });
        }
        return legs;
    });
    afterWrite(userId, rows, origin, 'deleted');
};

/** Pointage en masse (rapprochement avec le relevé bancaire). */
export const setChecked = async (userId: string, ids: string[], isChecked: boolean, origin?: string): Promise<number> => {
    const [count] = await Transaction.update(
        { isChecked, checkedAt: isChecked ? new Date() : null },
        { where: { userId, id: { [Op.in]: ids }, isChecked: !isChecked } },
    );
    if (count > 0) publish(userId, { model: 'transaction', type: 'bulk', origin });
    return count;
};

// ── Lecture ──────────────────────────────────────────────────────────────────

export type TransactionFilters = {
    accountId?: string;
    categoryId?: string;
    paymentMethodId?: string;
    type?: 'income' | 'expense' | 'transfer';
    isChecked?: boolean;
    from?: string;
    to?: string;
    q?: string;
    minAmount?: number;
    maxAmount?: number;
    /** Synchronisation incrémentale : renvoie aussi les opérations supprimées depuis cette date. */
    updatedSince?: string;
    sort?: 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';
    limit: number;
    offset: number;
};

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (ch) => `\\${ch}`);

export const listTransactions = async (userId: string, filters: TransactionFilters) => {
    const and: WhereOptions[] = [{ userId }];
    if (filters.accountId) and.push({ accountId: filters.accountId });
    if (filters.paymentMethodId) and.push({ paymentMethodId: filters.paymentMethodId });
    if (filters.type) and.push({ type: filters.type });
    if (filters.isChecked !== undefined) and.push({ isChecked: filters.isChecked });
    if (filters.from) and.push({ date: { [Op.gte]: filters.from } });
    if (filters.to) and.push({ date: { [Op.lte]: filters.to } });
    if (filters.categoryId) {
        // Filtrer sur une catégorie inclut ses sous-catégories.
        const children = await Category.findAll({ where: { userId, parentId: filters.categoryId }, attributes: ['id'] });
        and.push({ categoryId: { [Op.in]: [filters.categoryId, ...children.map((c) => c.id)] } });
    }
    if (filters.q?.trim()) {
        const q = filters.q.trim();
        const like = `%${escapeLike(q)}%`;
        const or: WhereOptions[] = [{ note: { [Op.iLike]: like } }, { chequeNumber: q }, { counterparty: { [Op.iLike]: like } }];
        const numeric = Number(q.replace(',', '.'));
        if (q !== '' && Number.isFinite(numeric)) or.push(sqlWhere(fn('ABS', col('amount')), round2(Math.abs(numeric))));
        and.push({ [Op.or]: or });
    }
    const absAmount = fn('ABS', col('amount'));
    if (filters.minAmount !== undefined) and.push(sqlWhere(absAmount, { [Op.gte]: filters.minAmount }));
    if (filters.maxAmount !== undefined) and.push(sqlWhere(absAmount, { [Op.lte]: filters.maxAmount }));

    const paranoid = !filters.updatedSince;
    if (filters.updatedSince) {
        const since = new Date(filters.updatedSince);
        and.push({ [Op.or]: [{ updatedAt: { [Op.gt]: since } }, { deletedAt: { [Op.gt]: since } }] });
    }

    const order = {
        date_desc: [['date', 'DESC'], ['createdAt', 'DESC'], ['id', 'ASC']],
        date_asc: [['date', 'ASC'], ['createdAt', 'ASC'], ['id', 'ASC']],
        amount_desc: [[absAmount, 'DESC'], ['id', 'ASC']],
        amount_asc: [[absAmount, 'ASC'], ['id', 'ASC']],
    }[filters.sort ?? 'date_desc'] as never;

    const where = { [Op.and]: and };
    const [rows, totals] = await Promise.all([
        Transaction.findAll({ where, order, limit: filters.limit, offset: filters.offset, paranoid }),
        Transaction.findOne({
            where,
            paranoid,
            raw: true,
            attributes: [
                [fn('COUNT', col('id')), 'total'],
                [sequelize.literal('COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0)'), 'credit'],
                [sequelize.literal('COALESCE(-SUM(amount) FILTER (WHERE amount < 0), 0)'), 'debit'],
            ],
        }) as unknown as Promise<{ total: string; credit: string; debit: string } | null>,
    ]);

    return {
        items: rows.map(serializeTransaction),
        total: Number(totals?.total ?? 0),
        sumCredit: toNumber(totals?.credit),
        sumDebit: toNumber(totals?.debit),
    };
};

export const getTransaction = async (userId: string, id: string) => {
    const row = await Transaction.findOne({ where: { id, userId } });
    if (!row) throw notFound('Opération introuvable');
    return row;
};

/**
 * Suggestions de saisie : pour chaque libellé déjà utilisé, la dernière catégorie,
 * le dernier moyen de paiement et le dernier montant, classés par fréquence.
 */
export const suggestTransactions = async (userId: string, q: string, limit = 8) => {
    const rows = await sequelize.query<{
        note: string;
        category_id: string | null;
        payment_method_id: string | null;
        account_id: string;
        type: 'income' | 'expense';
        amount: string;
        uses: string;
    }>(
        `SELECT * FROM (
            SELECT DISTINCT ON (lower(note)) note, category_id, payment_method_id, account_id, type, amount,
                   COUNT(*) OVER (PARTITION BY lower(note)) AS uses
              FROM transactions
             WHERE user_id = :userId AND deleted_at IS NULL AND type <> 'transfer'
               AND note IS NOT NULL AND note <> '' AND note ILIKE :pattern
             ORDER BY lower(note), date DESC, created_at DESC
         ) latest
         ORDER BY uses DESC, note ASC
         LIMIT :limit`,
        { replacements: { userId, pattern: `%${escapeLike(q.trim())}%`, limit }, type: QueryTypes.SELECT },
    );
    return rows.map((r) => ({
        note: r.note,
        categoryId: r.category_id,
        paymentMethodId: r.payment_method_id,
        accountId: r.account_id,
        type: r.type,
        amount: Math.abs(toNumber(r.amount)),
        uses: Number(r.uses),
    }));
};
