import type { Transaction as Tx } from 'sequelize';
import { Category, PaymentMethod, type PaymentKind } from '../db/models.js';

type SeedCategory = { name: string; icon: string; color: number; children: string[] };

const CATEGORIES: SeedCategory[] = [
    { name: 'Logement', icon: 'home', color: 0xffff9800, children: ['Loyer', 'Électricité', 'Eau', 'Gaz', 'Internet', 'Autre'] },
    { name: 'Courses', icon: 'shopping_cart', color: 0xff4caf50, children: ['Supermarché', 'Marché', 'Autre'] },
    { name: 'Restaurant', icon: 'restaurant', color: 0xffe91e63, children: ['Fast-food', 'Boulangerie', 'Livraison', 'Autre'] },
    { name: 'Transport', icon: 'directions_car', color: 0xff2196f3, children: ['Carburant', 'Parking', 'Péage', 'Train', 'Entretien', 'Autre'] },
    { name: 'Abonnements', icon: 'subscriptions', color: 0xff9c27b0, children: ['Streaming', 'Téléphone', 'Sport', 'Autre'] },
    { name: 'Santé', icon: 'medical_services', color: 0xfff44336, children: ['Médecin', 'Pharmacie', 'Remboursement', 'Autre'] },
    { name: 'Loisirs', icon: 'movie', color: 0xff009688, children: ['Cinéma', 'Sortie', 'Sport', 'Vacances', 'Autre'] },
    { name: 'Shopping', icon: 'shopping_bag', color: 0xff673ab7, children: ['Vêtements', 'High-tech', 'Maison', 'Autre'] },
    { name: 'Banque', icon: 'account_balance', color: 0xff607d8b, children: ['Frais bancaires', 'Intérêts', 'Assurance', 'Autre'] },
    { name: 'Revenus', icon: 'work', color: 0xff3f51b5, children: ['Salaire', 'Aides', 'Remboursement', 'Autre'] },
];

const PAYMENT_METHODS: { name: string; kind: PaymentKind; direction: 'income' | 'expense' }[] = [
    { name: 'Carte bancaire', kind: 'card', direction: 'expense' },
    { name: 'Prélèvement', kind: 'direct_debit', direction: 'expense' },
    { name: 'Virement', kind: 'transfer', direction: 'expense' },
    { name: 'Versement', kind: 'transfer', direction: 'income' },
    { name: 'Espèces', kind: 'cash', direction: 'expense' },
    { name: 'Chèque', kind: 'cheque', direction: 'expense' },
];

/** Jeu de départ d'un nouveau compte utilisateur. */
export const seedUserDefaults = async (userId: string, transaction?: Tx): Promise<void> => {
    const parents = await Category.bulkCreate(
        CATEGORIES.map((c, i) => ({ userId, name: c.name, iconCode: c.icon, colorValue: c.color, sortOrder: i })),
        { transaction },
    );
    await Category.bulkCreate(
        CATEGORIES.flatMap((c, i) =>
            c.children.map((name, j) => ({
                userId,
                name,
                iconCode: c.icon,
                colorValue: c.color,
                parentId: parents[i].id,
                sortOrder: j,
            })),
        ),
        { transaction },
    );
    await PaymentMethod.bulkCreate(
        PAYMENT_METHODS.map((m, i) => ({ userId, name: m.name, kind: m.kind, defaultDirection: m.direction, sortOrder: i })),
        { transaction },
    );
};
