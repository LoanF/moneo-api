'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('Users', {
            uid: {
                type: Sequelize.UUID,
                defaultValue: Sequelize.UUIDV4,
                primaryKey: true,
                allowNull: false,
            },
            username: {
                type: Sequelize.STRING,
                allowNull: false,
            },
            email: {
                type: Sequelize.STRING,
                allowNull: false,
                unique: true,
            },
            password: {
                type: Sequelize.STRING,
                allowNull: true,
            },
            googleId: {
                type: Sequelize.STRING,
                allowNull: true,
                unique: true,
            },
            refreshToken: {
                type: Sequelize.TEXT,
                allowNull: true,
            },
            fcmToken: {
                type: Sequelize.STRING,
                allowNull: true,
            },
            hasCompletedSetup: {
                type: Sequelize.BOOLEAN,
                allowNull: false,
                defaultValue: false,
            },
            photoUrl: {
                type: Sequelize.STRING,
                allowNull: true,
            },
            emailVerifiedAt: {
                type: Sequelize.DATE,
                allowNull: true,
            },
            emailVerificationCode: {
                type: Sequelize.STRING(6),
                allowNull: true,
            },
            passwordResetCode: {
                type: Sequelize.STRING(6),
                allowNull: true,
            },
            passwordResetExpires: {
                type: Sequelize.DATE,
                allowNull: true,
            },
            notificationPrefs: {
                type: Sequelize.JSONB,
                allowNull: true,
                defaultValue: null,
            },
            createdAt: {
                type: Sequelize.DATE,
                allowNull: false,
            },
            updatedAt: {
                type: Sequelize.DATE,
                allowNull: false,
            },
        });
    },

    async down(queryInterface) {
        await queryInterface.dropTable('Users');
    },
};
