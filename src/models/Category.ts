import { DataTypes, Model, type Optional } from 'sequelize';
import sequelize from '../config/database.js';
import User from './User.js';

interface CategoryAttributes {
    id: number;
    name: string;
    iconCode: number;
    colorValue: number;
    parentId: number | null;
    userId: number;
}

export interface CategoryCreationAttributes extends Optional<CategoryAttributes, 'id' | 'parentId'> {}

class Category extends Model<CategoryAttributes, CategoryCreationAttributes> implements CategoryAttributes {
    declare id: number;
    declare name: string;
    declare iconCode: number;
    declare colorValue: number;
    declare parentId: number | null;
    declare userId: number;
}

Category.init({
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    iconCode: { type: DataTypes.INTEGER, allowNull: false },
    colorValue: { type: DataTypes.BIGINT, allowNull: false },
    parentId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'Categories', key: 'id' }
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' }
    },
}, { sequelize, modelName: 'Category' });

User.hasMany(Category, { foreignKey: 'userId', as: 'categories' });
Category.belongsTo(User, { foreignKey: 'userId' });
Category.hasMany(Category, { foreignKey: 'parentId', as: 'subCategories' });
Category.belongsTo(Category, { foreignKey: 'parentId', as: 'parent' });

export default Category;