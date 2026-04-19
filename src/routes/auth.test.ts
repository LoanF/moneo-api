import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../types.js';

vi.mock('hono/jwt', () => ({
    sign: vi.fn(),
    verify: vi.fn(),
}));

vi.mock('google-auth-library', () => ({
    OAuth2Client: vi.fn().mockImplementation(() => ({
        verifyIdToken: vi.fn(),
    })),
}));

vi.mock('@aws-sdk/client-s3', () => ({
    S3Client: vi.fn().mockImplementation(() => ({ send: vi.fn() })),
    PutObjectCommand: vi.fn(),
}));

vi.mock('../models/Transaction.js', () => ({
    default: {
        create: vi.fn(),
        findOne: vi.fn(),
        findAll: vi.fn(),
        findAndCountAll: vi.fn(),
        findOrCreate: vi.fn(),
        destroy: vi.fn(),
    },
}));

vi.mock('../models/BankAccount.js', () => ({
    default: { findByPk: vi.fn(), findOne: vi.fn(), findAll: vi.fn(), findOrCreate: vi.fn() },
}));

vi.mock('../models/Category.js', () => ({
    default: { findAll: vi.fn(), findOrCreate: vi.fn(), bulkCreate: vi.fn() },
}));

vi.mock('../models/PaymentMethod.js', () => ({
    default: { findAll: vi.fn(), findOrCreate: vi.fn(), bulkCreate: vi.fn() },
}));

vi.mock('../models/MonthlyPayment.js', () => ({
    default: { findAll: vi.fn(), destroy: vi.fn() },
}));

vi.mock('../models/User.js', () => ({
    default: {
        create: vi.fn(),
        findOne: vi.fn(),
        findByPk: vi.fn(),
        findOrCreate: vi.fn(),
        update: vi.fn(),
    },
}));

vi.mock('../config/database.js', () => ({
    default: { transaction: vi.fn(), addHook: vi.fn() },
}));

vi.mock('../utils/seeder.js', () => ({
    seedUserCategories: vi.fn(),
}));

vi.mock('../services/messagingService.js', () => ({
    sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
    sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../utils/logger.js', () => ({
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../middleware/auth.js', () => ({
    authMiddleware: async (c: any, next: any) => {
        c.set('jwtPayload', { id: 'user-123', email: 'test@test.com', exp: 9999999999 });
        await next();
    },
}));

vi.mock('../middleware/rateLimiter.js', () => ({
    createRateLimiter: () => async (_c: any, next: any) => next(),
}));

import { sign, verify } from 'hono/jwt';
import User from '../models/User.js';
import sequelize from '../config/database.js';
import authRoutes from './auth.js';

const app = new OpenAPIHono<AppEnv>();
app.route('/', authRoutes);

const mockT = () => ({
    commit: vi.fn(),
    rollback: vi.fn(),
});

const USER_UUID = '550e8400-e29b-41d4-a716-446655440010';

describe('POST /login', () => {
    beforeEach(() => vi.clearAllMocks());

    it('connexion réussie avec identifiants valides', async () => {
        const mockUser = {
            uid: USER_UUID,
            email: 'test@example.com',
            username: 'TestUser',
            password: 'hashed',
            photoUrl: null,
            fcmToken: null,
            hasCompletedSetup: false,
            emailVerifiedAt: null,
            notificationPrefs: null,
            refreshToken: null,
            save: vi.fn(),
        };

        vi.mocked(User.findOne).mockResolvedValue(mockUser as any);
        vi.mocked(sign).mockResolvedValue('mock-access-token' as any);
        vi.spyOn(await import('../utils/password.js'), 'verifyPassword').mockResolvedValue(true);

        const res = await app.request('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'test@example.com', password: 'Password123!' }),
        });

        expect(res.status).toBe(200);
    });

    it('utilisateur introuvable → 401', async () => {
        vi.mocked(User.findOne).mockResolvedValue(null);

        const res = await app.request('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'inconnu@example.com', password: 'Password123!' }),
        });

        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.error).toBeDefined();
    });

    it('body sans email → 400', async () => {
        const res = await app.request('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: 'Password123!' }),
        });
        expect(res.status).toBe(400);
    });
});

describe('POST /refresh', () => {
    beforeEach(() => vi.clearAllMocks());

    it('refresh valide → nouveaux tokens en réponse', async () => {
        const mockUser = {
            uid: USER_UUID,
            email: 'test@example.com',
            refreshToken: 'valid-refresh-token',
            save: vi.fn(),
        };

        vi.mocked(verify).mockResolvedValue({ id: USER_UUID } as any);
        vi.mocked(User.findOne).mockResolvedValue(mockUser as any);
        vi.mocked(sign).mockResolvedValue('new-access-token' as any);

        const res = await app.request('/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: 'valid-refresh-token' }),
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toHaveProperty('accessToken');
        expect(body).toHaveProperty('refreshToken');
    });

    it('token expiré → 403', async () => {
        vi.mocked(verify).mockRejectedValue(new Error('jwt expired'));

        const res = await app.request('/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: 'token-expiré' }),
        });

        expect(res.status).toBe(403);
    });

    it('token non reconnu en base → 403', async () => {
        vi.mocked(verify).mockResolvedValue({ id: USER_UUID } as any);
        vi.mocked(User.findOne).mockResolvedValue(null);

        const res = await app.request('/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: 'token-inconnu' }),
        });

        expect(res.status).toBe(403);
    });
});

describe('POST /forgot-password', () => {
    beforeEach(() => vi.clearAllMocks());

    it('email inexistant → 200 quand même (anti-énumération)', async () => {
        vi.mocked(User.findOne).mockResolvedValue(null);

        const res = await app.request('/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'inconnu@example.com' }),
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
    });

    it('génère et sauvegarde un code de réinitialisation', async () => {
        const mockUser = {
            uid: USER_UUID,
            email: 'test@example.com',
            password: 'hashed',
            passwordResetCode: null,
            passwordResetExpires: null,
            save: vi.fn(),
        };
        vi.mocked(User.findOne).mockResolvedValue(mockUser as any);

        const res = await app.request('/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'test@example.com' }),
        });

        expect(res.status).toBe(200);
        expect(mockUser.save).toHaveBeenCalled();
        expect(mockUser.passwordResetCode).toBeDefined();
    });
});

describe('POST /register', () => {
    beforeEach(() => vi.clearAllMocks());

    it('mot de passe trop faible → 400', async () => {
        const res = await app.request('/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: 'TestUser',
                email: 'test@example.com',
                password: 'faible',
            }),
        });
        expect(res.status).toBe(400);
    });

    it('email malformé → 400', async () => {
        const res = await app.request('/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: 'TestUser',
                email: 'pas-un-email',
                password: 'Password123!',
            }),
        });
        expect(res.status).toBe(400);
    });

    it('inscription valide → 201 et commit de la transaction', async () => {
        const t = mockT();
        vi.mocked(sequelize.transaction).mockResolvedValue(t as any);
        vi.mocked(sign).mockResolvedValue('mock-token' as any);

        const mockUser = {
            uid: USER_UUID,
            email: 'nouveau@example.com',
            username: 'NouvelUtilisateur',
            password: null,
            photoUrl: null,
            fcmToken: null,
            hasCompletedSetup: false,
            emailVerifiedAt: null,
            notificationPrefs: null,
            refreshToken: null,
            emailVerificationCode: '123456',
            save: vi.fn(),
        };
        vi.mocked(User.create).mockResolvedValue(mockUser as any);

        const res = await app.request('/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: 'NouvelUtilisateur',
                email: 'nouveau@example.com',
                password: 'Password123!',
            }),
        });

        expect(res.status).toBe(201);
        expect(t.commit).toHaveBeenCalled();
    });
});
