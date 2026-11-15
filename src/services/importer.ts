import { randomUUID } from 'node:crypto';
import { z } from '@hono/zod-openapi';
import {
    BankAccount,
    Budget,
    Category,
    Chequebook,
    PaymentMethod,
    RecurringPayment,
    Transaction,
    User,
    sequelize,
    type PaymentKind,
} from '../db/models.js';
import { excelSerialToISO, isISODate, todayISO } from '../lib/dates.js';
import { badRequest } from '../lib/errors.js';
import { publish } from '../lib/events.js';
import { round2 } from '../lib/money.js';
import { columnRange, readWorkbook, type CellValue, type Sheet } from './xlsx.js';

// ── Format d'échange (identique à l'export JSON) ─────────────────────────────

const Name = z.string().trim().min(1).max(160);
const Kind = z.enum(['card', 'cheque', 'direct_debit', 'transfer', 'cash', 'other']);

export const ImportPayloadSchema = z
    .object({
        accounts: z.object({ name: Name, initialBalance: z.number().default(0), type: z.string().max(30).optional() }).array().max(200).default([]),
        categories: z
            .object({ name: Name, iconCode: z.string().max(60).optional(), colorValue: z.number().optional(), children: Name.array().max(200).default([]) })
            .array()
            .max(500)
            .default([]),
        paymentMethods: z.object({ name: Name, kind: Kind.default('other'), defaultDirection: z.enum(['income', 'expense']).default('expense') }).array().max(200).default([]),
        chequebooks: z.object({ name: Name, account: Name.nullish(), nextNumber: z.number().int().min(1).default(1) }).array().max(100).default([]),
        recurringPayments: z
            .object({
                name: Name,
                account: Name,
                category: Name.nullish(),
                subcategory: Name.nullish(),
                paymentMethod: Name.nullish(),
                type: z.enum(['income', 'expense']),
                dayOfMonth: z.number().int().min(1).max(31),
                amount: z.number().min(0),
                monthlyAmounts: z.record(z.string(), z.number().min(0)).nullish(),
                lastGeneratedPeriod: z.string().regex(/^\d{4}-\d{2}$/).nullish(),
            })
            .array()
            .max(500)
            .default([]),
        transactions: z
            .object({
                date: z.iso.date(),
                account: Name,
                type: z.enum(['income', 'expense', 'transfer']),
                amount: z.number(),
                category: Name.nullish(),
                subcategory: Name.nullish(),
                note: z.string().max(255).nullish(),
                paymentMethod: Name.nullish(),
                chequeNumber: z.string().max(20).nullish(),
                isChecked: z.boolean().default(false),
                /** Pour un transfert : nom de l'autre compte (suivi ou externe). */
                transferAccount: Name.nullish(),
            })
            .array()
            .max(100_000)
            .default([]),
        settings: z.object({ trackingStartDate: z.iso.date().nullish(), skipNote: z.boolean().optional() }).optional(),
    })
    .openapi('ImportPayload');

export type ImportPayload = z.infer<typeof ImportPayloadSchema>;
export type ImportReport = {
    accounts: number;
    categories: number;
    paymentMethods: number;
    chequebooks: number;
    recurringPayments: number;
    transactions: number;
    transfersPaired: number;
    warnings: string[];
};

const key = (name: string) => name.trim().toLocaleLowerCase('fr');

const PALETTE = [0xff4caf50, 0xff2196f3, 0xffff9800, 0xffe91e63, 0xff9c27b0, 0xff009688, 0xff3f51b5, 0xffffc107, 0xff795548, 0xff607d8b, 0xfff44336, 0xff00bcd4];
const ICONS: [RegExp, string][] = [
    [/abonnement/i, 'subscriptions'],
    [/course/i, 'shopping_cart'],
    [/internet/i, 'language'],
    [/achat|shopping/i, 'shopping_bag'],
    [/appartement|logement|maison|loyer/i, 'home'],
    [/assurance/i, 'shield'],
    [/banque/i, 'account_balance'],
    [/cadeau/i, 'card_giftcard'],
    [/dépôt|depot|versement|salaire|revenu/i, 'savings'],
    [/habillement|vêtement/i, 'checkroom'],
    [/loisir/i, 'movie'],
    [/retrait/i, 'local_atm'],
    [/santé/i, 'medical_services'],
    [/vacances|voyage/i, 'flight'],
    [/voiture|transport/i, 'directions_car'],
    [/restaurant/i, 'restaurant'],
    [/virement/i, 'swap_horiz'],
    [/chat|chien|animal/i, 'pets'],
];
const iconFor = (name: string) => ICONS.find(([re]) => re.test(name))?.[1] ?? 'category';

/** Efface toutes les données financières de l'utilisateur (le compte et ses réglages restent). */
const wipe = async (userId: string, transaction: import('sequelize').Transaction) => {
    await Transaction.destroy({ where: { userId }, force: true, transaction });
    await RecurringPayment.destroy({ where: { userId }, transaction });
    await Budget.destroy({ where: { userId }, transaction });
    await Chequebook.destroy({ where: { userId }, transaction });
    await PaymentMethod.destroy({ where: { userId }, transaction });
    await Category.destroy({ where: { userId }, transaction });
    await BankAccount.destroy({ where: { userId }, transaction });
};

export const importData = async (userId: string, payload: ImportPayload, mode: 'merge' | 'replace'): Promise<ImportReport> => {
    const report: ImportReport = {
        accounts: 0,
        categories: 0,
        paymentMethods: 0,
        chequebooks: 0,
        recurringPayments: 0,
        transactions: 0,
        transfersPaired: 0,
        warnings: [],
    };
    const warn = (message: string) => {
        if (report.warnings.length < 50) report.warnings.push(message);
    };

    await sequelize.transaction(async (transaction) => {
        if (mode === 'replace') await wipe(userId, transaction);

        // Comptes
        const accounts = new Map((await BankAccount.findAll({ where: { userId }, transaction })).map((a) => [key(a.name), a.id]));
        let sortOrder = accounts.size;
        const ensureAccount = async (name: string, initialBalance = 0, type = 'checking') => {
            const existing = accounts.get(key(name));
            if (existing) return existing;
            const account = await BankAccount.create(
                { userId, name: name.trim().slice(0, 80), initialBalance: round2(initialBalance), type, sortOrder: sortOrder++ },
                { transaction },
            );
            accounts.set(key(name), account.id);
            report.accounts += 1;
            return account.id;
        };
        for (const a of payload.accounts) await ensureAccount(a.name, a.initialBalance, a.type);

        // Catégories (deux niveaux)
        const allCategories = await Category.findAll({ where: { userId }, transaction });
        const roots = new Map(allCategories.filter((c) => !c.parentId).map((c) => [key(c.name), c]));
        const subs = new Map(allCategories.filter((c) => c.parentId).map((c) => [`${c.parentId}|${key(c.name)}`, c.id]));
        const ensureCategory = async (name: string, iconCode?: string, colorValue?: number) => {
            const existing = roots.get(key(name));
            if (existing) return existing;
            const category = await Category.create(
                {
                    userId,
                    name: name.trim().slice(0, 80),
                    iconCode: iconCode ?? iconFor(name),
                    colorValue: colorValue ?? PALETTE[roots.size % PALETTE.length],
                    sortOrder: roots.size,
                },
                { transaction },
            );
            roots.set(key(name), category);
            report.categories += 1;
            return category;
        };
        const ensureSubcategory = async (root: Category, name: string) => {
            const id = `${root.id}|${key(name)}`;
            const existing = subs.get(id);
            if (existing) return existing;
            const sub = await Category.create(
                { userId, name: name.trim().slice(0, 80), iconCode: root.iconCode, colorValue: root.colorValue, parentId: root.id, sortOrder: subs.size },
                { transaction },
            );
            subs.set(id, sub.id);
            report.categories += 1;
            return sub.id;
        };
        const resolveCategory = async (category?: string | null, subcategory?: string | null): Promise<string | null> => {
            if (!category) return null;
            const root = await ensureCategory(category);
            return subcategory ? ensureSubcategory(root, subcategory) : root.id;
        };
        for (const c of payload.categories) {
            const root = await ensureCategory(c.name, c.iconCode, c.colorValue);
            for (const child of c.children) await ensureSubcategory(root, child);
        }

        // Moyens de paiement
        const methods = new Map((await PaymentMethod.findAll({ where: { userId }, transaction })).map((m) => [key(m.name), m.id]));
        const ensureMethod = async (name: string, kind: PaymentKind = 'other', defaultDirection: 'income' | 'expense' = 'expense') => {
            const existing = methods.get(key(name));
            if (existing) return existing;
            const method = await PaymentMethod.create(
                { userId, name: name.trim().slice(0, 80), kind, defaultDirection, sortOrder: methods.size },
                { transaction },
            );
            methods.set(key(name), method.id);
            report.paymentMethods += 1;
            return method.id;
        };
        for (const m of payload.paymentMethods) await ensureMethod(m.name, m.kind, m.defaultDirection);

        // Chéquiers
        const books = new Set((await Chequebook.findAll({ where: { userId }, transaction })).map((b) => key(b.name)));
        for (const b of payload.chequebooks) {
            if (books.has(key(b.name))) continue;
            await Chequebook.create(
                { userId, name: b.name.slice(0, 80), nextNumber: b.nextNumber, accountId: b.account ? await ensureAccount(b.account) : null },
                { transaction },
            );
            books.add(key(b.name));
            report.chequebooks += 1;
        }

        // Mensualités
        const existingRecurring = new Set(
            (await RecurringPayment.findAll({ where: { userId }, transaction })).map((p) => `${p.accountId}|${key(p.name)}|${p.dayOfMonth}`),
        );
        for (const p of payload.recurringPayments) {
            const accountId = await ensureAccount(p.account);
            const id = `${accountId}|${key(p.name)}|${p.dayOfMonth}`;
            if (existingRecurring.has(id)) continue;
            await RecurringPayment.create(
                {
                    userId,
                    accountId,
                    categoryId: await resolveCategory(p.category, p.subcategory),
                    paymentMethodId: p.paymentMethod ? await ensureMethod(p.paymentMethod) : null,
                    name: p.name,
                    amount: round2(p.amount),
                    type: p.type,
                    dayOfMonth: p.dayOfMonth,
                    monthlyAmounts: p.monthlyAmounts && Object.keys(p.monthlyAmounts).length > 0 ? p.monthlyAmounts : null,
                    lastGeneratedPeriod: p.lastGeneratedPeriod ?? null,
                },
                { transaction },
            );
            existingRecurring.add(id);
            report.recurringPayments += 1;
        }

        // Opérations
        type Row = import('sequelize').CreationAttributes<Transaction>;
        const rows: Row[] = [];
        /** Jambes de transfert en attente de leur miroir, indexées par (date, montant, paire de comptes). */
        const unmatched = new Map<string, { out: Row[]; in: Row[] }>();

        for (const t of payload.transactions) {
            const amount = round2(t.amount);
            if (amount === 0) {
                warn(`Opération à montant nul ignorée (${t.date}, ${t.account})`);
                continue;
            }
            const accountId = await ensureAccount(t.account);
            const isTransfer = t.type === 'transfer';
            const row: Row = {
                id: randomUUID(),
                userId,
                accountId,
                categoryId: isTransfer ? null : await resolveCategory(t.category, t.subcategory),
                paymentMethodId: t.paymentMethod ? await ensureMethod(t.paymentMethod) : null,
                chequeNumber: t.chequeNumber?.trim() || null,
                amount: isTransfer ? amount : t.type === 'expense' ? -Math.abs(amount) : Math.abs(amount),
                type: t.type,
                date: t.date,
                note: t.note?.trim() || null,
                isChecked: t.isChecked,
                checkedAt: t.isChecked ? new Date() : null,
                source: 'import',
            };
            if (isTransfer && t.transferAccount) {
                const otherId = accounts.get(key(t.transferAccount));
                if (!otherId) {
                    row.counterparty = t.transferAccount.slice(0, 120);
                } else {
                    const pairKey = `${t.date}|${Math.abs(amount)}|${[accountId, otherId].sort().join('|')}`;
                    const bucket = unmatched.get(pairKey) ?? { out: [], in: [] };
                    const mirror = (amount < 0 ? bucket.in : bucket.out).shift();
                    if (mirror) {
                        row.transferId = mirror.transferId = randomUUID();
                        report.transfersPaired += 1;
                    } else {
                        (amount < 0 ? bucket.out : bucket.in).push(row);
                        row.counterparty = t.transferAccount.slice(0, 120);
                    }
                    if (mirror) mirror.counterparty = null;
                    unmatched.set(pairKey, bucket);
                }
            }
            rows.push(row);
        }
        const orphans = [...unmatched.values()].reduce((n, b) => n + b.out.length + b.in.length, 0);
        if (orphans > 0) warn(`${orphans} transfert(s) sans écriture miroir : conservés tels quels`);

        for (let i = 0; i < rows.length; i += 1000) {
            await Transaction.bulkCreate(rows.slice(i, i + 1000), { transaction, validate: false });
        }
        report.transactions = rows.length;

        if (payload.settings) {
            const user = await User.findByPk(userId, { transaction });
            if (user) {
                user.settings = {
                    ...user.settings,
                    ...(payload.settings.trackingStartDate ? { trackingStartDate: payload.settings.trackingStartDate } : {}),
                    ...(payload.settings.skipNote !== undefined ? { skipNote: payload.settings.skipNote } : {}),
                };
                user.hasCompletedSetup = true;
                await user.save({ transaction });
            }
        }
    });

    for (const model of ['account', 'category', 'paymentMethod', 'chequebook', 'recurringPayment', 'transaction', 'user'] as const) {
        publish(userId, { model, type: 'bulk' });
    }
    return report;
};

// ── Classeur « Comptes.xlsm » ────────────────────────────────────────────────

const str = (v: CellValue): string => (v === null ? '' : String(v).trim());
const num = (v: CellValue): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const kindFromName = (name: string): PaymentKind => {
    if (/^ch/i.test(name)) return 'cheque';
    if (/carte|paypal|lydia/i.test(name)) return 'card';
    if (/prélèvement|prelevement/i.test(name)) return 'direct_debit';
    if (/virement|versement/i.test(name)) return 'transfer';
    if (/espèces|especes|retrait|dab/i.test(name)) return 'cash';
    return 'other';
};

const requireSheet = (sheets: Map<string, Sheet>, name: string): Sheet => {
    const sheet = sheets.get(name);
    if (!sheet) throw badRequest(`Feuille « ${name} » introuvable : ce fichier n’est pas un classeur Comptes`);
    return sheet;
};

/** Convertit le classeur de suivi de comptes en données importables. */
export const parseComptesWorkbook = (data: Uint8Array, today: string = todayISO()): { payload: ImportPayload; warnings: string[] } => {
    const sheets = readWorkbook(data);
    const system = requireSheet(sheets, 'Système');
    const entries = requireSheet(sheets, 'Ecritures');
    const warnings: string[] = [];

    // Feuille « Système » : comptes (A/B), modes de paiement (D/E/F), réglages (H).
    const accounts: ImportPayload['accounts'] = [];
    const paymentMethods: ImportPayload['paymentMethods'] = [];
    const chequebooks: ImportPayload['chequebooks'] = [];
    for (let r = 2; r <= system.maxRow; r++) {
        const account = str(system.cell(`A${r}`));
        if (account) accounts.push({ name: account, initialBalance: num(system.cell(`B${r}`)) ?? 0 });
        const mode = str(system.cell(`D${r}`));
        if (!mode) continue;
        const kind = kindFromName(mode);
        paymentMethods.push({ name: mode, kind, defaultDirection: /cr[ée]dit/i.test(str(system.cell(`F${r}`))) ? 'income' : 'expense' });
        const lastCheque = num(system.cell(`E${r}`));
        if (kind === 'cheque' && lastCheque !== null) chequebooks.push({ name: mode, nextNumber: Math.max(1, Math.round(lastCheque) + 1) });
    }
    const startSerial = num(system.cell('H2'));
    const trackingStartDate = startSerial && startSerial > 20000 ? excelSerialToISO(startSerial) : null;
    const lastMonth = num(system.cell('H4'));
    const skipNote = system.cell('H5') === true || system.cell('H5') === 1;

    // La dernière mensualisation est connue par son numéro de mois : on en déduit l'année.
    let lastGeneratedPeriod: string | null = null;
    if (lastMonth && lastMonth >= 1 && lastMonth <= 12) {
        const currentMonth = Number(today.slice(5, 7));
        const year = Number(today.slice(0, 4)) - (lastMonth > currentMonth ? 1 : 0);
        lastGeneratedPeriod = `${year}-${String(lastMonth).padStart(2, '0')}`;
    }

    // Feuille « BD » : libellés principaux (A) et secondaires (B…). La ligne 2 « Transfert » est technique.
    const categories: ImportPayload['categories'] = [];
    const database = sheets.get('BD');
    if (database) {
        for (let r = 3; r <= database.maxRow; r++) {
            const row = database.rows.get(r);
            const name = str(row?.get('A') ?? null);
            if (!row || !name) continue;
            const children = [...row.entries()].filter(([col]) => col !== 'A').map(([, v]) => str(v)).filter(Boolean);
            categories.push({ name, children: [...new Set(children)] });
        }
    }

    // Feuille « Mensualisation » : une colonne de montant par mois (H…S).
    const recurringPayments: ImportPayload['recurringPayments'] = [];
    const monthly = sheets.get('Mensualisation');
    if (monthly) {
        const monthColumns = columnRange('H', 'S');
        for (let r = 2; r <= monthly.maxRow; r++) {
            const account = str(monthly.cell(`B${r}`));
            const category = str(monthly.cell(`C${r}`));
            if (!account || !category) continue;
            const amounts = monthColumns.map((col) => round2(num(monthly.cell(`${col}${r}`)) ?? 0));
            // Le montant par défaut est le plus fréquent ; les autres mois deviennent des exceptions.
            const frequency = new Map<number, number>();
            for (const a of amounts) frequency.set(a, (frequency.get(a) ?? 0) + 1);
            const amount = [...frequency.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
            const monthlyAmounts = Object.fromEntries(amounts.flatMap((a, i) => (a !== amount ? [[String(i + 1), a]] : [])));
            const subcategory = str(monthly.cell(`D${r}`));
            const free = str(monthly.cell(`E${r}`));
            recurringPayments.push({
                name: free || subcategory || category,
                account,
                category,
                subcategory: subcategory || null,
                paymentMethod: str(monthly.cell(`F${r}`)) || null,
                type: /cr[ée]dit/i.test(str(monthly.cell(`G${r}`))) ? 'income' : 'expense',
                dayOfMonth: Math.min(31, Math.max(1, Math.round(num(monthly.cell(`A${r}`)) ?? 1))),
                amount,
                monthlyAmounts,
                lastGeneratedPeriod,
            });
        }
    }

    // Feuille « Ecritures » : le tableau commence sous la ligne d'en-tête « Date ».
    let header = 0;
    for (let r = 1; r <= Math.min(entries.maxRow, 30); r++) {
        if (str(entries.cell(`A${r}`)) === 'Date' && str(entries.cell(`B${r}`)) === 'Compte') header = r;
    }
    if (!header) throw badRequest('Tableau des écritures introuvable dans la feuille « Ecritures »');

    const transactions: ImportPayload['transactions'] = [];
    let badDates = 0;
    for (let r = header + 1; r <= entries.maxRow; r++) {
        const account = str(entries.cell(`B${r}`));
        if (!account) continue;
        const credit = num(entries.cell(`H${r}`)) ?? 0;
        const debit = num(entries.cell(`I${r}`)) ?? 0;
        if (credit === 0 && debit === 0) {
            warnings.push(`Ligne ${r} : ni crédit ni débit, ignorée`);
            continue;
        }
        const serial = num(entries.cell(`A${r}`));
        let date = serial && serial > 20000 ? excelSerialToISO(serial) : null;
        if (!date || !isISODate(date)) {
            badDates += 1;
            date = trackingStartDate ?? today;
        }
        const category = str(entries.cell(`C${r}`));
        const subcategory = str(entries.cell(`D${r}`));
        const isTransfer = key(category) === 'transfert';
        const cheque = entries.cell(`G${r}`);
        transactions.push({
            date,
            account,
            type: isTransfer ? 'transfer' : credit > 0 ? 'income' : 'expense',
            amount: round2(credit > 0 ? credit : -debit),
            category: isTransfer ? null : category || null,
            subcategory: isTransfer ? null : subcategory || null,
            note: str(entries.cell(`E${r}`)) || null,
            paymentMethod: str(entries.cell(`F${r}`)) || null,
            chequeNumber: cheque === null ? null : String(cheque),
            isChecked: str(entries.cell(`J${r}`)) !== '',
            transferAccount: isTransfer ? subcategory || null : null,
        });
    }
    if (badDates > 0) warnings.push(`${badDates} écriture(s) sans date valide : placée(s) au ${trackingStartDate ?? today}`);

    const payload = ImportPayloadSchema.parse({
        accounts,
        categories,
        paymentMethods,
        chequebooks,
        recurringPayments,
        transactions,
        settings: { trackingStartDate, skipNote },
    });
    return { payload, warnings };
};

// ── Export ───────────────────────────────────────────────────────────────────

export const exportData = async (userId: string): Promise<ImportPayload> => {
    const [accounts, categories, methods, books, recurring, transactions, user] = await Promise.all([
        BankAccount.findAll({ where: { userId }, order: [['sortOrder', 'ASC']] }),
        Category.findAll({ where: { userId }, order: [['sortOrder', 'ASC']] }),
        PaymentMethod.findAll({ where: { userId }, order: [['sortOrder', 'ASC']] }),
        Chequebook.findAll({ where: { userId } }),
        RecurringPayment.findAll({ where: { userId } }),
        Transaction.findAll({ where: { userId }, order: [['date', 'ASC'], ['createdAt', 'ASC']] }),
        User.findByPk(userId),
    ]);
    const accountName = new Map(accounts.map((a) => [a.id, a.name]));
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    const methodName = new Map(methods.map((m) => [m.id, m.name]));
    const labels = (categoryId: string | null) => {
        const category = categoryId ? categoryById.get(categoryId) : undefined;
        if (!category) return { category: null, subcategory: null };
        const parent = category.parentId ? categoryById.get(category.parentId) : undefined;
        return parent ? { category: parent.name, subcategory: category.name } : { category: category.name, subcategory: null };
    };
    const otherLeg = new Map<string, Transaction[]>();
    for (const t of transactions) if (t.transferId) otherLeg.set(t.transferId, [...(otherLeg.get(t.transferId) ?? []), t]);

    return {
        accounts: accounts.map((a) => ({ name: a.name, initialBalance: a.initialBalance, type: a.type })),
        categories: categories
            .filter((c) => !c.parentId)
            .map((c) => ({
                name: c.name,
                iconCode: c.iconCode,
                colorValue: c.colorValue,
                children: categories.filter((s) => s.parentId === c.id).map((s) => s.name),
            })),
        paymentMethods: methods.map((m) => ({ name: m.name, kind: m.kind, defaultDirection: m.defaultDirection })),
        chequebooks: books.map((b) => ({ name: b.name, account: b.accountId ? (accountName.get(b.accountId) ?? null) : null, nextNumber: b.nextNumber })),
        recurringPayments: recurring.map((p) => ({
            name: p.name,
            account: accountName.get(p.accountId) ?? '',
            ...labels(p.categoryId),
            paymentMethod: p.paymentMethodId ? (methodName.get(p.paymentMethodId) ?? null) : null,
            type: p.type,
            dayOfMonth: p.dayOfMonth,
            amount: p.amount,
            monthlyAmounts: p.monthlyAmounts,
            lastGeneratedPeriod: p.lastGeneratedPeriod,
        })),
        transactions: transactions.map((t) => {
            const pair = t.transferId ? otherLeg.get(t.transferId)?.find((o) => o.id !== t.id) : undefined;
            return {
                date: t.date,
                account: accountName.get(t.accountId) ?? '',
                type: t.type,
                amount: t.amount,
                ...labels(t.categoryId),
                note: t.note,
                paymentMethod: t.paymentMethodId ? (methodName.get(t.paymentMethodId) ?? null) : null,
                chequeNumber: t.chequeNumber,
                isChecked: t.isChecked,
                transferAccount: pair ? (accountName.get(pair.accountId) ?? null) : t.counterparty,
            };
        }),
        settings: { trackingStartDate: user?.settings.trackingStartDate ?? null, skipNote: user?.settings.skipNote },
    };
};

/** Une cellule qui commence par = + - @ serait interprétée comme une formule par un tableur. */
const csvCell = (value: string | null | undefined): string => {
    let text = value ?? '';
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const csvAmount = (value: number): string => (value === 0 ? '' : value.toFixed(2).replace('.', ','));

/** Export au format du tableau « Ecritures » (séparateur point-virgule, lisible par Excel en français). */
export const exportCsv = async (userId: string): Promise<string> => {
    const data = await exportData(userId);
    const lines = [
        ['Date', 'Compte', 'Libellé principal', 'Libellé secondaire', 'Libellé libre', 'Mode de paiement', 'N° de chèque', 'Crédit', 'Débit', 'P'].join(';'),
        ...data.transactions.map((t) =>
            [
                t.date.split('-').reverse().join('/'),
                csvCell(t.account),
                csvCell(t.type === 'transfer' ? 'Transfert' : t.category),
                csvCell(t.type === 'transfer' ? t.transferAccount : t.subcategory),
                csvCell(t.note),
                csvCell(t.paymentMethod),
                csvCell(t.chequeNumber),
                csvAmount(t.amount > 0 ? t.amount : 0),
                csvAmount(t.amount < 0 ? -t.amount : 0),
                t.isChecked ? 'P' : '',
            ].join(';'),
        ),
    ];
    return `﻿${lines.join('\r\n')}\r\n`;
};

