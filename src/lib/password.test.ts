import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('hashPassword', () => {
    it('retourne une string au format salt.hash', async () => {
        const hash = await hashPassword('MyPassword1!');
        expect(typeof hash).toBe('string');
        expect(hash).toContain('.');
        const parts = hash.split('.');
        expect(parts).toHaveLength(2);
        expect(parts[0]).toBeTruthy();
        expect(parts[1]).toBeTruthy();
    });

    it('génère un hash différent pour le même mot de passe (salt aléatoire)', async () => {
        const hash1 = await hashPassword('MyPassword1!');
        const hash2 = await hashPassword('MyPassword1!');
        expect(hash1).not.toBe(hash2);
    });
});

describe('verifyPassword', () => {
    it('retourne true avec le bon mot de passe', async () => {
        const password = 'MyPassword1!';
        const hash = await hashPassword(password);
        const result = await verifyPassword(password, hash);
        expect(result).toBe(true);
    });

    it('retourne false avec un mauvais mot de passe', async () => {
        const hash = await hashPassword('MyPassword1!');
        const result = await verifyPassword('WrongPassword1!', hash);
        expect(result).toBe(false);
    });

    it('retourne false si le hash est malformé', async () => {
        const result = await verifyPassword('MyPassword1!', 'invalide');
        expect(result).toBe(false);
    });
});
