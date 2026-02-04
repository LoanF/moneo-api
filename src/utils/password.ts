import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const KEY_LEN = 64;
const SALT_LEN = 16;

export const hashPassword = async (password: string): Promise<string> => {
    const salt = randomBytes(SALT_LEN).toString('hex');
    const derivedKey = (await scryptAsync(password, salt, KEY_LEN)) as Buffer;

    return `${salt}.${derivedKey.toString('hex')}`;
};

export const verifyPassword = async (password: string, storedHash: string): Promise<boolean> => {
    const [salt, hash] = storedHash.split('.');
    if (!salt || !hash) return false;

    const derivedKey = (await scryptAsync(password, salt, KEY_LEN)) as Buffer;
    const keyToVerify = Buffer.from(hash, 'hex');

    return timingSafeEqual(derivedKey, keyToVerify);
};