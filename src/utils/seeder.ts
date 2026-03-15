import Category from '../models/Category.js';
import { logger } from './logger.js';

export const seedUserCategories = async (userId: string) => {
    try {
        const parents = await Category.bulkCreate([
            // Dépenses
            { name: 'Alimentation', iconCode: 'restaurant', colorValue: 0xFF4CAF50, userId },
            { name: 'Transport', iconCode: 'directions_car', colorValue: 0xFF2196F3, userId },
            { name: 'Logement', iconCode: 'home', colorValue: 0xFFFF9800, userId },
            { name: 'Santé', iconCode: 'medical_services', colorValue: 0xFFE91E63, userId },
            { name: 'Shopping', iconCode: 'shopping_cart', colorValue: 0xFF9C27B0, userId },
            { name: 'Loisirs', iconCode: 'movie', colorValue: 0xFF009688, userId },
            // Revenus
            { name: 'Salaire', iconCode: 'work', colorValue: 0xFF3F51B5, userId },
            { name: 'Épargne', iconCode: 'savings', colorValue: 0xFFFFC107, userId },
        ]);

        const alimentId = parents.find(c => c.name === 'Alimentation')?.id;
        const transportId = parents.find(c => c.name === 'Transport')?.id;
        const shoppingId = parents.find(c => c.name === 'Shopping')?.id;
        const loisirId = parents.find(c => c.name === 'Loisirs')?.id;

        const subCategories = [];

        if (alimentId) {
            subCategories.push(
                { name: 'Courses', iconCode: 'fastfood', colorValue: 0xFF4CAF50, userId, parentId: alimentId },
                { name: 'Restaurants', iconCode: 'restaurant', colorValue: 0xFF4CAF50, userId, parentId: alimentId }
            );
        }

        if (transportId) {
            subCategories.push(
                { name: 'Carburant', iconCode: 'local_gas_station', colorValue: 0xFF2196F3, userId, parentId: transportId },
                { name: 'Voyage', iconCode: 'flight', colorValue: 0xFF2196F3, userId, parentId: transportId }
            );
        }

        if (shoppingId) {
            subCategories.push(
                { name: 'Vêtements', iconCode: 'checkroom', colorValue: 0xFF9C27B0, userId, parentId: shoppingId }
            );
        }

        if (loisirId) {
            subCategories.push(
                { name: 'Sport', iconCode: 'fitness_center', colorValue: 0xFF009688, userId, parentId: loisirId }
            );
        }

        if (subCategories.length > 0) {
            await Category.bulkCreate(subCategories);
        }

        logger.info(`Seed des catégories terminé avec succès pour ${userId}`);
    } catch (error) {
        logger.error(error, `Erreur lors du seeding pour ${userId}`);
    }
};