import { describe, it, expect } from 'vitest';
import { RegisterSchema, UpdateProfileSchema } from './auth.schema.js';

describe('RegisterSchema', () => {
    it('valide un payload correct', () => {
        const result = RegisterSchema.safeParse({
            username: 'JohnDoe',
            email: 'john@example.com',
            password: 'Password123!',
        });
        expect(result.success).toBe(true);
    });

    it('rejette un mot de passe sans majuscule', () => {
        const result = RegisterSchema.safeParse({
            username: 'JohnDoe',
            email: 'john@example.com',
            password: 'password123!',
        });
        expect(result.success).toBe(false);
    });

    it('rejette un mot de passe trop court', () => {
        const result = RegisterSchema.safeParse({
            username: 'JohnDoe',
            email: 'john@example.com',
            password: 'P1!',
        });
        expect(result.success).toBe(false);
    });

    it('rejette un email invalide', () => {
        const result = RegisterSchema.safeParse({
            username: 'JohnDoe',
            email: 'not-an-email',
            password: 'Password123!',
        });
        expect(result.success).toBe(false);
    });

    it('rejette un username trop court', () => {
        const result = RegisterSchema.safeParse({
            username: 'ab',
            email: 'john@example.com',
            password: 'Password123!',
        });
        expect(result.success).toBe(false);
    });
});

describe('UpdateProfileSchema', () => {
    it('accepte les champs valides', () => {
        const result = UpdateProfileSchema.safeParse({
            username: 'NewName',
            hasCompletedSetup: true,
        });
        expect(result.success).toBe(true);
    });

    it('accepte un objet vide (tous les champs sont optionnels)', () => {
        const result = UpdateProfileSchema.safeParse({});
        expect(result.success).toBe(true);
    });

    it("n'a plus les champs id, email, payment_methods dans son résultat", () => {
        const result = UpdateProfileSchema.safeParse({
            id: 'some-id',
            email: 'test@example.com',
            payment_methods: [],
            username: 'ValidName',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data).not.toHaveProperty('id');
            expect(result.data).not.toHaveProperty('email');
            expect(result.data).not.toHaveProperty('payment_methods');
        }
    });

    it('rejette un username trop court', () => {
        const result = UpdateProfileSchema.safeParse({ username: 'ab' });
        expect(result.success).toBe(false);
    });
});
