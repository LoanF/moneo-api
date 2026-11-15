import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Transaction } from '../src/db/models.js';
import { addDays, todayISO } from '../src/lib/dates.js';
import { balanceOf, createAccount, createUser } from './helpers.js';

const TX = '/transactions';
const today = todayISO();

describe('soldes calculés', () => {
    it('déduit le solde du solde initial et des écritures, sans dérive flottante', async () => {
        const { api } = await createUser();
        const account = await createAccount(api, 'Courant', 284.42);
        for (const amount of [0.1, 0.2, 68.01, 12.39]) await api('POST', TX, { accountId: account.id, type: 'expense', amount });
        await api('POST', TX, { accountId: account.id, type: 'income', amount: 108.4 });

        const state = await balanceOf(api, account.id);
        expect(state.balance).toBe(312.12);
        expect(state.initialBalance).toBe(284.42);
        expect(state.transactionCount).toBe(5);
    });

    it('impose le signe d’après le type, quel que soit le signe envoyé', async () => {
        const { api } = await createUser();
        const account = await createAccount(api);
        const expense = await api('POST', TX, { accountId: account.id, type: 'expense', amount: 25 });
        const income = await api('POST', TX, { accountId: account.id, type: 'income', amount: -40 });
        expect(expense.body.amount).toBe(-25);
        expect(income.body.amount).toBe(40);
        expect((await balanceOf(api, account.id)).balance).toBe(15);
    });

    it('distingue solde restant, solde pointé et solde à ce jour', async () => {
        const { api } = await createUser();
        const account = await createAccount(api, 'Courant', 1000);
        const a = await api('POST', TX, { accountId: account.id, type: 'expense', amount: 100 });
        await api('POST', TX, { accountId: account.id, type: 'income', amount: 30 });
        await api('POST', TX, { accountId: account.id, type: 'expense', amount: 200, date: addDays(today, 10) });
        await api('PATCH', `${TX}/${a.body.id}`, { isChecked: true });

        expect(await balanceOf(api, account.id)).toMatchObject({
            balance: 730,
            pointedBalance: 900,
            todayBalance: 930,
            uncheckedCredit: 30,
            uncheckedDebit: 200,
            uncheckedCount: 2,
        });
    });

    it('modifier le solde initial décale tous les soldes', async () => {
        const { api } = await createUser();
        const account = await createAccount(api, 'Courant', 100);
        await api('POST', TX, { accountId: account.id, type: 'expense', amount: 40 });
        await api('PATCH', `/accounts/${account.id}`, { initialBalance: 500 });
        expect((await balanceOf(api, account.id)).balance).toBe(460);
    });

    it('déplacer une opération vers un autre compte corrige les deux soldes', async () => {
        const { api } = await createUser();
        const a = await createAccount(api, 'A', 100);
        const b = await createAccount(api, 'B', 100);
        const tx = await api('POST', TX, { accountId: a.id, type: 'expense', amount: 30 });
        await api('PATCH', `${TX}/${tx.body.id}`, { accountId: b.id, amount: 45 });
        expect((await balanceOf(api, a.id)).balance).toBe(100);
        expect((await balanceOf(api, b.id)).balance).toBe(55);
    });

    it('changer le type inverse le signe', async () => {
        const { api } = await createUser();
        const account = await createAccount(api);
        const tx = await api('POST', TX, { accountId: account.id, type: 'expense', amount: 30 });
        const updated = await api('PATCH', `${TX}/${tx.body.id}`, { type: 'income' });
        expect(updated.body.amount).toBe(30);
        expect((await balanceOf(api, account.id)).balance).toBe(30);
    });
});

describe('cloisonnement entre utilisateurs', () => {
    it('ne divulgue pas l’opération d’un autre utilisateur lors d’un rejeu d’identifiant', async () => {
        const alice = await createUser();
        const bob = await createUser();
        const aliceAccount = await createAccount(alice.api);
        const bobAccount = await createAccount(bob.api);
        const id = randomUUID();
        await alice.api('POST', TX, { id, accountId: aliceAccount.id, type: 'expense', amount: 99, note: 'secret' });

        const replay = await bob.api('POST', TX, { id, accountId: bobAccount.id, type: 'expense', amount: 1 });
        expect(replay.status).toBe(409);
        expect(JSON.stringify(replay.body)).not.toContain('secret');
        expect((await bob.api('GET', `${TX}/${id}`)).status).toBe(404);
        expect((await bob.api('PATCH', `${TX}/${id}`, { amount: 1 })).status).toBe(404);
        expect((await bob.api('DELETE', `${TX}/${id}`)).status).toBe(404);
    });

    it('refuse un compte, une catégorie ou un moyen de paiement qui ne sont pas à soi', async () => {
        const alice = await createUser();
        const bob = await createUser();
        const aliceAccount = await createAccount(alice.api);
        const bobAccount = await createAccount(bob.api);
        const aliceCategory = (await alice.api('POST', '/categories', { name: 'Privé' })).body;
        const aliceMethod = (await alice.api('POST', '/payment-methods', { name: 'Carte Alice' })).body;

        expect((await bob.api('POST', TX, { accountId: aliceAccount.id, type: 'expense', amount: 5 })).status).toBe(404);
        expect((await bob.api('POST', TX, { accountId: bobAccount.id, type: 'expense', amount: 5, categoryId: aliceCategory.id })).status).toBe(404);
        expect((await bob.api('POST', TX, { accountId: bobAccount.id, type: 'expense', amount: 5, paymentMethodId: aliceMethod.id })).status).toBe(404);
        expect((await bob.api('POST', '/accounts', { id: aliceAccount.id, name: 'Vol' })).status).toBe(409);
        expect((await bob.api('PATCH', `/accounts/${aliceAccount.id}`, { name: 'Vol' })).status).toBe(404);
        expect((await bob.api('DELETE', `/accounts/${aliceAccount.id}`)).status).toBe(404);
    });

    it('rejoue une création sans dupliquer (idempotence hors-ligne)', async () => {
        const { api } = await createUser();
        const account = await createAccount(api);
        const payload = { id: randomUUID(), accountId: account.id, type: 'expense', amount: 12 };
        expect((await api('POST', TX, payload)).status).toBe(201);
        expect((await api('POST', TX, payload)).status).toBe(200);
        const batch = await api('POST', `${TX}/batch`, {
            transactions: [payload, { id: randomUUID(), accountId: account.id, type: 'income', amount: 5 }, { accountId: randomUUID(), type: 'expense', amount: 1 }],
        });
        expect(batch.body.results.map((r: any) => r.status)).toEqual(['exists', 'created', 'error']);
        expect((await balanceOf(api, account.id)).balance).toBe(-7);
    });
});

describe('transferts', () => {
    it('crée deux écritures miroir et laisse le total inchangé', async () => {
        const { api } = await createUser();
        const a = await createAccount(api, 'Courant', 1000);
        const b = await createAccount(api, 'Livret', 500);
        const res = await api('POST', `${TX}/transfers`, { fromAccountId: a.id, toAccountId: b.id, amount: 250 });
        expect(res.status).toBe(201);
        expect(res.body.transactions.map((t: any) => t.amount).sort()).toEqual([-250, 250]);
        expect((await balanceOf(api, a.id)).balance).toBe(750);
        expect((await balanceOf(api, b.id)).balance).toBe(750);
    });

    it('supprimer une jambe supprime l’autre et restaure exactement les soldes', async () => {
        const { api } = await createUser();
        const a = await createAccount(api, 'Courant', 1000);
        const b = await createAccount(api, 'Livret', 500);
        // Un autre transfert le même jour ne doit pas être touché.
        const keep = await api('POST', `${TX}/transfers`, { fromAccountId: a.id, toAccountId: b.id, amount: 10 });
        const res = await api('POST', `${TX}/transfers`, { fromAccountId: a.id, toAccountId: b.id, amount: 250 });

        const incoming = res.body.transactions.find((t: any) => t.amount > 0);
        expect((await api('DELETE', `${TX}/${incoming.id}`)).status).toBe(200);
        expect((await balanceOf(api, a.id)).balance).toBe(990);
        expect((await balanceOf(api, b.id)).balance).toBe(510);
        expect(await Transaction.count({ where: { transferId: keep.body.transferId } })).toBe(2);
        expect(await Transaction.count({ where: { transferId: res.body.transferId } })).toBe(0);
    });

    it('répercute montant et date sur les deux jambes, mais pas le pointage', async () => {
        const { api } = await createUser();
        const a = await createAccount(api, 'Courant', 1000);
        const b = await createAccount(api, 'Livret', 0);
        const res = await api('POST', `${TX}/transfers`, { fromAccountId: a.id, toAccountId: b.id, amount: 100 });
        const out = res.body.transactions.find((t: any) => t.amount < 0);
        await api('PATCH', `${TX}/${out.id}`, { amount: 300, date: '2026-01-15', isChecked: true });

        const legs = await Transaction.findAll({ where: { transferId: res.body.transferId } });
        expect(legs.map((l) => l.amount).sort((x, y) => x - y)).toEqual([-300, 300]);
        expect(legs.every((l) => l.date === '2026-01-15')).toBe(true);
        expect(legs.filter((l) => l.isChecked)).toHaveLength(1);
        expect((await api('PATCH', `${TX}/${out.id}`, { accountId: b.id })).status).toBe(400);
    });

    it('est idempotent et refuse un transfert vers le même compte', async () => {
        const { api } = await createUser();
        const a = await createAccount(api, 'A', 100);
        const b = await createAccount(api, 'B', 0);
        const payload = { id: randomUUID(), fromAccountId: a.id, toAccountId: b.id, amount: 20 };
        expect((await api('POST', `${TX}/transfers`, payload)).status).toBe(201);
        expect((await api('POST', `${TX}/transfers`, payload)).status).toBe(200);
        expect((await balanceOf(api, a.id)).balance).toBe(80);
        expect((await api('POST', `${TX}/transfers`, { fromAccountId: a.id, toAccountId: a.id, amount: 5 })).status).toBe(400);
    });

    it('gère un transfert vers un compte externe non suivi', async () => {
        const { api } = await createUser();
        const a = await createAccount(api, 'A', 100);
        const res = await api('POST', `${TX}/transfers`, { fromAccountId: a.id, counterparty: 'PEA', amount: 60 });
        expect(res.body.transactions).toHaveLength(1);
        expect(res.body.transactions[0]).toMatchObject({ amount: -60, counterparty: 'PEA', type: 'transfer' });
        expect((await balanceOf(api, a.id)).balance).toBe(40);
    });
});

describe('chéquiers', () => {
    const setup = async () => {
        const { api } = await createUser();
        const account = await createAccount(api);
        const methods = (await api('GET', '/payment-methods')).body as any[];
        const cheque = methods.find((m) => m.kind === 'cheque');
        const card = methods.find((m) => m.kind === 'card');
        const book = (await api('POST', '/chequebooks', { name: 'Carnet 1', accountId: account.id, nextNumber: 31 })).body;
        const pay = (extra: object = {}) => api('POST', TX, { accountId: account.id, type: 'expense', amount: 10, paymentMethodId: cheque.id, ...extra });
        const nextNumber = async () => ((await api('GET', '/chequebooks')).body as any[]).find((b) => b.id === book.id).nextNumber;
        return { api, account, cheque, card, book, pay, nextNumber };
    };

    it('numérote automatiquement les chèques émis', async () => {
        const { pay, nextNumber, book } = await setup();
        expect((await pay()).body).toMatchObject({ chequeNumber: '31', chequebookId: book.id });
        expect((await pay()).body.chequeNumber).toBe('32');
        expect(await nextNumber()).toBe(33);
    });

    it('libère le numéro quand on annule le dernier chèque, pas un plus ancien', async () => {
        const { api, pay, nextNumber } = await setup();
        const first = await pay();
        const second = await pay();
        await api('DELETE', `${TX}/${first.body.id}`);
        expect(await nextNumber()).toBe(33);
        await api('DELETE', `${TX}/${second.body.id}`);
        expect(await nextNumber()).toBe(32);
    });

    it('retire le numéro quand le paiement n’est plus un chèque', async () => {
        const { api, pay, card, nextNumber } = await setup();
        const tx = await pay();
        const updated = await api('PATCH', `${TX}/${tx.body.id}`, { paymentMethodId: card.id });
        expect(updated.body).toMatchObject({ chequeNumber: null, chequebookId: null });
        expect(await nextNumber()).toBe(31);
    });

    it('accepte un numéro saisi à la main et recale le chéquier', async () => {
        const { pay, nextNumber } = await setup();
        expect((await pay({ chequeNumber: '50' })).body.chequeNumber).toBe('50');
        expect(await nextNumber()).toBe(51);
    });

    it('ne numérote pas un chèque encaissé', async () => {
        const { api, account, cheque, nextNumber } = await setup();
        const res = await api('POST', TX, { accountId: account.id, type: 'income', amount: 80, paymentMethodId: cheque.id, chequeNumber: '7741' });
        expect(res.body).toMatchObject({ chequeNumber: '7741', chequebookId: null });
        expect(await nextNumber()).toBe(31);
    });
});

describe('liste, filtres et pointage', () => {
    const seed = async () => {
        const { api } = await createUser();
        const account = await createAccount(api);
        const other = await createAccount(api, 'Autre');
        const categories = (await api('GET', '/categories')).body as any[];
        const root = categories.find((c) => c.name === 'Restaurant');
        const sub = categories.find((c) => c.parentId === root.id);
        const mk = (o: object) => api('POST', TX, { accountId: account.id, type: 'expense', amount: 10, ...o });
        await mk({ amount: 7.6, note: 'Mc-Do', categoryId: sub.id, date: '2026-03-01' });
        await mk({ amount: 68.01, note: 'TotalEnergies', date: '2026-03-02' });
        await mk({ amount: 50, type: 'income', note: 'Gain 100% sûr_', date: '2026-03-05' });
        await mk({ amount: 5, note: 'Kebab', categoryId: root.id, date: '2026-04-01' });
        await api('POST', TX, { accountId: other.id, type: 'expense', amount: 999, date: '2026-03-03' });
        return { api, account, root };
    };

    it('filtre par compte, période, type et catégorie (sous-catégories incluses)', async () => {
        const { api, account, root } = await seed();
        const march = await api('GET', `${TX}?accountId=${account.id}&from=2026-03-01&to=2026-03-31`);
        expect(march.body).toMatchObject({ total: 3, sumCredit: 50, sumDebit: 75.61 });
        expect(march.body.items.map((t: any) => t.date)).toEqual(['2026-03-05', '2026-03-02', '2026-03-01']);

        expect((await api('GET', `${TX}?accountId=${account.id}&type=income`)).body.total).toBe(1);
        expect((await api('GET', `${TX}?categoryId=${root.id}`)).body.total).toBe(2);
        expect((await api('GET', `${TX}?minAmount=60&maxAmount=70`)).body.items[0].note).toBe('TotalEnergies');
        expect((await api('GET', `${TX}?accountId=${account.id}&sort=amount_desc&limit=1`)).body.items[0].amount).toBe(-68.01);
    });

    it('recherche dans les libellés sans interpréter les jokers SQL', async () => {
        const { api } = await seed();
        expect((await api('GET', `${TX}?q=keb`)).body.total).toBe(1);
        expect((await api('GET', `${TX}?q=${encodeURIComponent('100%')}`)).body.total).toBe(1);
        expect((await api('GET', `${TX}?q=${encodeURIComponent('%')}`)).body.total).toBe(1);
        expect((await api('GET', `${TX}?q=68,01`)).body.total).toBe(1);
    });

    it('pointe en masse et filtre sur le pointage', async () => {
        const { api, account } = await seed();
        const all = (await api('GET', `${TX}?accountId=${account.id}`)).body.items;
        const res = await api('POST', `${TX}/check`, { ids: all.slice(0, 3).map((t: any) => t.id), isChecked: true });
        expect(res.body.updated).toBe(3);
        expect((await api('GET', `${TX}?accountId=${account.id}&isChecked=false`)).body.total).toBe(1);
        expect((await balanceOf(api, account.id)).uncheckedCount).toBe(1);
    });

    it('expose les suppressions pour la synchronisation incrémentale', async () => {
        const { api, account } = await seed();
        const since = new Date(Date.now() - 1000).toISOString();
        const tx = await api('POST', TX, { accountId: account.id, type: 'expense', amount: 3 });
        await api('DELETE', `${TX}/${tx.body.id}`);
        const delta = await api('GET', `${TX}?updatedSince=${encodeURIComponent(since)}&limit=1000`);
        const deleted = delta.body.items.find((t: any) => t.id === tx.body.id);
        expect(deleted.deletedAt).not.toBeNull();
        // La liste normale, elle, ne contient pas l'opération supprimée.
        expect((await api('GET', `${TX}?accountId=${account.id}`)).body.items.some((t: any) => t.id === tx.body.id)).toBe(false);
    });

    it('propose des suggestions de saisie classées par fréquence', async () => {
        const { api, account } = await seed();
        await api('POST', TX, { accountId: account.id, type: 'expense', amount: 9, note: 'mc-do' });
        const res = await api('GET', `${TX}/suggestions?q=mc`);
        expect(res.body[0]).toMatchObject({ uses: 2, amount: 9, type: 'expense' });
    });

    it('valide les entrées', async () => {
        const { api, account } = await seed();
        expect((await api('POST', TX, { accountId: account.id, type: 'expense', amount: 0 })).status).toBe(400);
        expect((await api('POST', TX, { accountId: account.id, type: 'expense', amount: 5, date: '2026-02-30' })).status).toBe(400);
        expect((await api('POST', TX, { accountId: 'pas-un-uuid', type: 'expense', amount: 5 })).status).toBe(400);
        expect((await api('GET', `${TX}?limit=5000`)).status).toBe(400);
    });
});

describe('comptes et catalogue', () => {
    it('supprimer un compte emporte ses opérations', async () => {
        const { api, user } = await createUser();
        const account = await createAccount(api);
        await api('POST', TX, { accountId: account.id, type: 'expense', amount: 5 });
        expect((await api('DELETE', `/accounts/${account.id}`)).status).toBe(200);
        expect(await Transaction.count({ where: { userId: user.id }, paranoid: false })).toBe(0);
    });

    it('réordonne les comptes', async () => {
        const { api } = await createUser();
        const a = await createAccount(api, 'A');
        const b = await createAccount(api, 'B');
        const res = await api('PUT', '/accounts/order', { ids: [b.id, a.id] });
        expect(res.body.map((x: any) => x.name)).toEqual(['B', 'A']);
        expect((await api('PUT', '/accounts/order', { ids: [randomUUID()] })).status).toBe(400);
    });

    it('limite les catégories à deux niveaux', async () => {
        const { api } = await createUser();
        const root = (await api('POST', '/categories', { name: 'Racine' })).body;
        const child = (await api('POST', '/categories', { name: 'Enfant', parentId: root.id })).body;
        expect(child.parentId).toBe(root.id);
        expect((await api('POST', '/categories', { name: 'Petit-enfant', parentId: child.id })).status).toBe(400);
        expect((await api('PATCH', `/categories/${root.id}`, { parentId: root.id })).status).toBe(400);
    });

    it('supprimer une catégorie conserve les opérations', async () => {
        const { api } = await createUser();
        const account = await createAccount(api);
        const category = (await api('POST', '/categories', { name: 'Temporaire' })).body;
        const tx = await api('POST', TX, { accountId: account.id, type: 'expense', amount: 5, categoryId: category.id });
        await api('DELETE', `/categories/${category.id}`);
        expect((await api('GET', `${TX}/${tx.body.id}`)).body.categoryId).toBeNull();
    });

    it('charge tout l’état initial en un appel', async () => {
        const { api } = await createUser();
        await createAccount(api, 'Courant', 50);
        const res = await api('GET', '/bootstrap');
        expect(res.status).toBe(200);
        expect(res.body.accounts[0].balance).toBe(50);
        expect(res.body.categories.length).toBeGreaterThan(0);
        expect(res.body).toHaveProperty('unreadNotifications', 0);
    });
});
