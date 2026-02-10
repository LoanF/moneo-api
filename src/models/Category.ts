import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database.js';
import User from './User.js';

interface CategoryAttributes {
    id: string;
    name: string;
    iconCode: number;
    colorValue: number;
    parentId: string | null;
    userId: string;
}

export interface CategoryCreationAttributes extends Optional<CategoryAttributes, 'id' | 'parentId'> {}

class Category extends Model<CategoryAttributes, CategoryCreationAttributes> implements CategoryAttributes {
    declare id: string;
    declare name: string;
    declare iconCode: number;
    declare colorValue: number;
    declare parentId: string | null;
    declare userId: string;
}

Category.init({
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    iconCode: { type: DataTypes.INTEGER, allowNull: false },
    colorValue: { type: DataTypes.BIGINT, allowNull: false },
    parentId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'Categories', key: 'id' }
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'Users', key: 'uid' }
    },
}, { sequelize, modelName: 'Category' });

User.hasMany(Category, { foreignKey: 'userId', as: 'categories' });
Category.belongsTo(User, { foreignKey: 'userId' });
Category.hasMany(Category, { foreignKey: 'parentId', as: 'subCategories' });
Category.belongsTo(Category, { foreignKey: 'parentId', as: 'parent' });

export default Category;