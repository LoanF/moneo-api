import Category from '../models/Category.js';

export const seedUserCategories = async (userId: string) => {
    try {
        const parents = await Category.bulkCreate([
            // Dépenses
            { name: 'Alimentation', iconCode: 58947, colorValue: 0xFFF44336, userId },
            { name: 'Transport', iconCode: 58673, colorValue: 0xFF2196F3, userId },
            { name: 'Logement', iconCode: 59530, colorValue: 0xFFFF9800, userId },
            { name: 'Loisirs', iconCode: 58162, colorValue: 0xFF9C27B0, userId },
            { name: 'Santé', iconCode: 59504, colorValue: 0xFF4CAF50, userId },
            { name: 'Shopping', iconCode: 59596, colorValue: 0xFFE91E63, userId },

            // Revenus
            { name: 'Salaire', iconCode: 57895, colorValue: 0xFF00C853, userId },
            { name: 'Cadeau', iconCode: 59638, colorValue: 0xFFFFD600, userId },
            { name: 'Vente', iconCode: 58914, colorValue: 0xFF00B0FF, userId },
        ]);

        const alimentId = parents.find(c => c.name === 'Alimentation')?.id;
        const transportId = parents.find(c => c.name === 'Transport')?.id;
        const loisirId = parents.find(c => c.name === 'Loisirs')?.id;

        const subCategories = [];

        if (alimentId) {
            subCategories.push(
                { name: 'Courses', iconCode: 59596, colorValue: 0xFFF44336, userId, parentId: alimentId },
                { name: 'Restaurants', iconCode: 57933, colorValue: 0xFFF44336, userId, parentId: alimentId }
            );
        }

        if (transportId) {
            subCategories.push(
                { name: 'Carburant', iconCode: 58711, colorValue: 0xFF2196F3, userId, parentId: transportId },
                { name: 'Parking', iconCode: 58674, colorValue: 0xFF2196F3, userId, parentId: transportId }
            );
        }

        if (loisirId) {
            subCategories.push(
                { name: 'Cinéma', iconCode: 59384, colorValue: 0xFF9C27B0, userId, parentId: loisirId },
                { name: 'Sport', iconCode: 58714, colorValue: 0xFF9C27B0, userId, parentId: loisirId }
            );
        }

        if (subCategories.length > 0) {
            await Category.bulkCreate(subCategories);
        }

        console.log(`🌱 Arborescence de catégories initialisée pour l'utilisateur ${userId}`);
    } catch (error) {
        console.error(`❌ Erreur lors du seeding pour l'utilisateur ${userId}:`, error);
    }
};