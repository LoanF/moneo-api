import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { sign, verify } from 'hono/jwt';
import { env } from '../config/env.js';

export const ACCESS_TOKEN_TTL_S = 15 * 60;
export const SESSION_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 jours glissants
/** Fenêtre pendant laquelle l'ancien refresh token reste accepté (réponse perdue, requêtes concurrentes). */
export const REFRESH_GRACE_MS = 60 * 1000;

export type AccessClaims = { sub: string; sid: string; email: string; exp: number };

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export const safeEqualHex = (a: string, b: string): boolean => {
    if (a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
};

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export const generateCode = (): string => randomInt(0, 1_000_000).toString().padStart(6, '0');

export const signAccessToken = (userId: string, sessionId: string, email: string): Promise<string> =>
    sign(
        { sub: userId, sid: sessionId, email, exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_S },
        env.ACCESS_TOKEN_SECRET,
        'HS256',
    );

export const verifyAccessToken = async (token: string): Promise<AccessClaims> => {
    const payload = (await verify(token, env.ACCESS_TOKEN_SECRET, 'HS256')) as Partial<AccessClaims>;
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') throw new Error('Jeton invalide');
    return payload as AccessClaims;
};

/** Le refresh token est opaque : `<sessionId>.<secret>`. Seul son SHA-256 est stocké. */
export const buildRefreshToken = (sessionId: string): { token: string; hash: string } => {
    const token = `${sessionId}.${randomToken(32)}`;
    return { token, hash: sha256(token) };
};

export const sessionIdFromRefreshToken = (token: string): string | null => {
    const id = token.split('.')[0];
    return /^[0-9a-f-]{36}$/i.test(id ?? '') ? id : null;
};
