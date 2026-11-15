import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { Chequebook, RecurringPayment, Transaction, User } from '../src/db/models.js';
import { parseComptesWorkbook } from '../src/services/importer.js';
import { columnRange, readWorkbook } from '../src/services/xlsx.js';
import { app, balanceOf, createAccount, createUser } from './helpers.js';

// ── Fabrique d'un classeur minimal, à la structure du fichier « Comptes.xlsm » ──

type Cell = string | number | boolean;
const column = (index: number) => columnRange('A', 'ZZ')[index];

const sheetXml = (rows: Record<number, (Cell | null)[]>) => {
    const body = Object.entries(rows)
        .map(([r, cells]) => {
            const xml = cells
                .map((value, i) => {
                    if (value === null) return '';
                    const ref = `${column(i)}${r}`;
                    if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
                    if (typeof value === 'boolean') return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
                    const escaped = value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
                    return `<c r="${ref}" t="inlineStr"><is><t>${escaped}</t></is></c>`;
                })
                .join('');
            return `<row r="${r}">${xml}</row>`;
        })
        .join('');
    return `<?xml version="1.0"?><worksheet><sheetData>${body}</sheetData></worksheet>`;
};

const workbook = (sheets: Record<string, Record<number, (Cell | null)[]>>) => {
    const names = Object.keys(sheets);
    const files: Record<string, Uint8Array> = {
        'xl/workbook.xml': strToU8(
            `<?xml version="1.0"?><workbook><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
        ),
        'xl/_rels/workbook.xml.rels': strToU8(
            `<?xml version="1.0"?><Relationships>${names.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`,
        ),
        'xl/vbaProject.bin': strToU8('macros jamais lues'),
    };
    names.forEach((name, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sheets[name]))));
    return zipSync(files);
};

const D = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000);

const comptes = () =>
    workbook({
        Système: {
            1: ['Nom des comptes', 'Soldes', null, 'Mode de paiement', 'Numéro des chèques', 'Par défaut', null, 'Date de début de suivi'],
            2: ['Compte', 284.42, null, 'Carte Bancaire', 'Pas de chèque', 'Débit', null, D('2023-01-01')],
            3: ['Livret A', 930.7, null, 'Chèque', 30, 'Débit', null, 'Mensualisation'],
            4: [null, null, null, 'Versement', 'Pas de chèque', 'Crédit', null, 10],
            5: [null, null, null, 'Virement', 'Pas de chèque', 'Débit', null, true],
        },
        Ecritures: {
            2: [null, null, null, null, 'Nom des comptes', 'Total Crédit'],
            5: ['Date', 'Compte', 'Libellé Principal', 'Libellé Secondaire', 'Libellé Libre', 'Mode de Paiement', 'N° de Chèque', 'Crédit', 'Débit', 'P'],
            6: [3, 'Compte', 'Dépôt d\'argent', 'Dépôt de liquidité', null, 'Versement', null, 80, null, 'P'],
            7: [D('2023-01-02'), 'Compte', 'Restaurant', 'Fast-Food', 'Mc-Do & Co', 'Carte Bancaire', null, null, 7.6, 'P'],
            8: [D('2023-01-03'), 'Compte', 'Voiture', 'Carburant', null, 'Chèque', 30, null, 68.010000000000005],
            9: [D('2023-02-01'), 'Compte', 'Transfert', 'Livret A', 'Épargne', 'Virement', null, null, 100, 'P'],
            10: [D('2023-02-01'), 'Livret A', 'Transfert', 'Compte', 'Épargne', 'Versement', null, 100, null, 'P'],
            11: [D('2023-02-05'), 'Compte', 'Transfert', 'PEA', null, 'Virement', null, null, 50],
            12: [D('2023-02-06'), 'Compte', 'Restaurant', 'Autre', null, 'Carte Bancaire'],
        },
        BD: {
            1: ['Libellés principaux', 'Libellés secondaires'],
            2: ['Transfert', 'Compte', 'Livret A'],
            3: ['Restaurant', 'Fast-Food', 'Boulangerie', 'Autre'],
            4: ['Voiture', 'Carburant', 'Parking'],
        },
        Mensualisation: {
            1: ['Jour du mois', 'Compte', 'Libellé Principal', 'Libellé Secondaire', 'Libellé Libre', 'Mode de Paiement', 'Crédit\nDébit', 'Janvier'],
            2: [7, 'Compte', 'Assurances', 'MAIF', null, 'Prélèvement', 'Débit', ...Array(11).fill(85.38), 85.41],
            3: [28, 'Compte', 'Versements', 'Salaire', 'Paie', 'Versement', 'Crédit', ...Array(12).fill(1500)],
        },
    });

describe('lecture du classeur', () => {
    it('lit les cellules sans jamais toucher aux macros', () => {
        const sheets = readWorkbook(comptes());
        expect([...sheets.keys()]).toEqual(['Système', 'Ecritures', 'BD', 'Mensualisation']);
        expect(sheets.get('Ecritures')!.cell('E7')).toBe('Mc-Do & Co');
        expect(sheets.get('Système')!.cell('H5')).toBe(true);
        expect(sheets.get('Système')!.cell('C2')).toBeNull();
    });

    it('rejette un fichier qui n’est pas un classeur', () => {
        expect(() => readWorkbook(strToU8('pas un zip'))).toThrow(/classeur Excel/);
        expect(() => parseComptesWorkbook(workbook({ Autre: { 1: ['x'] } }))).toThrow(/Système/);
    });

    it('traduit le classeur en données importables', () => {
        const { payload, warnings } = parseComptesWorkbook(comptes(), '2026-11-14');
        expect(payload.accounts).toEqual([
            { name: 'Compte', initialBalance: 284.42 },
            { name: 'Livret A', initialBalance: 930.7 },
        ]);
        expect(payload.paymentMethods.find((m) => m.name === 'Chèque')).toMatchObject({ kind: 'cheque', defaultDirection: 'expense' });
        expect(payload.paymentMethods.find((m) => m.name === 'Versement')).toMatchObject({ kind: 'transfer', defaultDirection: 'income' });
        expect(payload.chequebooks).toEqual([{ name: 'Chèque', nextNumber: 31 }]);
        expect(payload.categories.map((c) => c.name)).toEqual(['Restaurant', 'Voiture']);
        expect(payload.settings).toEqual({ trackingStartDate: '2023-01-01', skipNote: true });

        const [insurance, salary] = payload.recurringPayments;
        expect(insurance).toMatchObject({ name: 'MAIF', amount: 85.38, monthlyAmounts: { '12': 85.41 }, type: 'expense', dayOfMonth: 7, lastGeneratedPeriod: '2026-10' });
        expect(salary).toMatchObject({ name: 'Paie', amount: 1500, monthlyAmounts: {}, type: 'income' });

        expect(payload.transactions).toHaveLength(6);
        expect(payload.transactions[2]).toMatchObject({ amount: -68.01, chequeNumber: '30', isChecked: false });
        expect(payload.transactions[3]).toMatchObject({ type: 'transfer', amount: -100, transferAccount: 'Livret A', category: null });
        // Date invalide (un simple « 3 ») : replacée au début du suivi, et signalée.
        expect(payload.transactions[0].date).toBe('2023-01-01');
        expect(warnings.join(' ')).toMatch(/Ligne 12/);
        expect(warnings.join(' ')).toMatch(/1 écriture\(s\) sans date valide/);
    });

    it('déduit l’année de la dernière mensualisation quand le mois est « dans le futur »', () => {
        const { payload } = parseComptesWorkbook(comptes(), '2026-03-10');
        expect(payload.recurringPayments[0].lastGeneratedPeriod).toBe('2025-10');
    });
});

describe('import', () => {
    const upload = async (token: string, mode = 'replace') => {
        const form = new FormData();
        form.append('file', new File([comptes()], 'Comptes.xlsm'));
        const res = await app.request(`/api/v1/data/import/comptes?mode=${mode}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
        return { status: res.status, body: await res.json() };
    };

    it('importe le classeur et retrouve les soldes du tableau Excel', async () => {
        const { api, accessToken, user } = await createUser();
        await createAccount(api, 'Ancien compte', 999);
        const res = await upload(accessToken);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ accounts: 2, transactions: 6, transfersPaired: 1, recurringPayments: 2, chequebooks: 1 });

        const accounts = (await api('GET', '/accounts')).body as any[];
        expect(accounts.map((a) => a.name)).toEqual(['Compte', 'Livret A']);
        // Compte : 284,42 + 80 − 7,60 − 68,01 − 100 − 50 ; pointé : 284,42 + 80 − 7,60 − 100.
        expect(accounts[0]).toMatchObject({ balance: 138.81, pointedBalance: 256.82, uncheckedDebit: 118.01 });
        expect(accounts[1]).toMatchObject({ balance: 1030.7, pointedBalance: 1030.7 });

        const transfers = await Transaction.findAll({ where: { userId: user.id, type: 'transfer' }, order: [['amount', 'ASC']] });
        expect(transfers).toHaveLength(3);
        expect(transfers[0].transferId).toBe(transfers[2].transferId);
        expect(transfers[1]).toMatchObject({ amount: -50, counterparty: 'PEA', transferId: null });

        expect((await Chequebook.findOne({ where: { userId: user.id } }))!.nextNumber).toBe(31);
        expect((await User.findByPk(user.id))!.settings).toMatchObject({ trackingStartDate: '2023-01-01', skipNote: true });
        const recurring = await RecurringPayment.findAll({ where: { userId: user.id } });
        expect(recurring.every((p) => p.lastGeneratedPeriod !== null)).toBe(true);
    });

    it('en mode fusion, ne duplique ni comptes ni catégories', async () => {
        const { api, accessToken } = await createUser();
        await upload(accessToken, 'merge');
        const before = ((await api('GET', '/categories')).body as any[]).length;
        const second = await upload(accessToken, 'merge');
        expect(second.body).toMatchObject({ accounts: 0, categories: 0, paymentMethods: 0, recurringPayments: 0 });
        expect(((await api('GET', '/categories')).body as any[]).length).toBe(before);
    });

    it('exporte en JSON ré-importable et en CSV sans injection de formule', async () => {
        const source = await createUser();
        await upload(source.accessToken);
        const account = ((await source.api('GET', '/accounts')).body as any[])[0];
        await source.api('POST', '/transactions', { accountId: account.id, type: 'expense', amount: 5, note: '=CMD()' });

        const exported = await source.api('GET', '/data/export');
        expect(exported.body.transactions).toHaveLength(7);

        const target = await createUser();
        const imported = await target.api('POST', '/data/import/json?mode=replace', exported.body);
        expect(imported.status).toBe(200);
        expect(imported.body.transfersPaired).toBe(1);
        const copy = ((await target.api('GET', '/accounts')).body as any[])[0];
        expect(copy.balance).toBe((await balanceOf(source.api, account.id)).balance);

        const csv = await source.api('GET', '/data/export?format=csv');
        expect(csv.headers.get('content-type')).toContain('text/csv');
        const lines = String(csv.body).split('\r\n');
        expect(lines[0]).toContain('Date;Compte;Libellé principal');
        expect(lines.some((l) => l.includes("'=CMD()"))).toBe(true);
        expect(lines.some((l) => l.includes(';Transfert;Livret A;'))).toBe(true);
    });

    it('refuse un fichier absent ou invalide', async () => {
        const { accessToken } = await createUser();
        const form = new FormData();
        form.append('file', new File(['pas un classeur'], 'x.xlsm'));
        const res = await app.request('/api/v1/data/import/comptes', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: form });
        expect(res.status).toBe(400);
    });
});
