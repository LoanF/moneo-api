import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';
import { addDays, addMonths, budgetPeriod, clampDay, daysInMonth, diffDays, excelSerialToISO, isISODate, todayISO } from '../src/lib/dates.js';
import { round2 } from '../src/lib/money.js';
import { generateCode, sessionIdFromRefreshToken, buildRefreshToken, sha256 } from '../src/lib/tokens.js';
import { RateLimit } from '../src/middleware/rateLimiter.js';
import { anonymous, app } from './helpers.js';

describe('dates', () => {
    it('calcule le jour courant dans le fuseau de l’application', () => {
        // 23 h 30 UTC le 31 décembre = déjà le 1er janvier à Paris.
        expect(todayISO(new Date('2026-12-31T23:30:00Z'), 'Europe/Paris')).toBe('2027-01-01');
        expect(todayISO(new Date('2026-12-31T23:30:00Z'), 'UTC')).toBe('2026-12-31');
    });

    it('ramène le jour au dernier du mois, années bissextiles comprises', () => {
        expect(clampDay('2026-02', 31)).toBe('2026-02-28');
        expect(clampDay('2028-02', 30)).toBe('2028-02-29');
        expect(clampDay('2026-04', 31)).toBe('2026-04-30');
        expect(daysInMonth('2026-12')).toBe(31);
    });

    it('enchaîne mois et jours par-delà les années', () => {
        expect(addMonths('2026-12', 1)).toBe('2027-01');
        expect(addMonths('2026-01', -1)).toBe('2025-12');
        expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
        expect(diffDays('2026-01-01', '2026-01-31')).toBe(30);
    });

    it('valide les dates réelles uniquement', () => {
        expect(isISODate('2026-02-28')).toBe(true);
        expect(isISODate('2026-02-30')).toBe(false);
        expect(isISODate('28/02/2026')).toBe(false);
    });

    it('calcule la période budgétaire selon le premier jour choisi', () => {
        expect(budgetPeriod('2026-11-14', 1)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
        expect(budgetPeriod('2026-11-14', 25)).toEqual({ from: '2026-10-25', to: '2026-11-24' });
        expect(budgetPeriod('2026-11-26', 25)).toEqual({ from: '2026-11-25', to: '2026-12-24' });
    });

    it('convertit les numéros de série Excel', () => {
        expect(excelSerialToISO(44926)).toBe('2022-12-31');
        expect(excelSerialToISO(46023)).toBe('2026-01-01');
    });
});

describe('montants et jetons', () => {
    it('arrondit sans artefact binaire', () => {
        expect(round2(0.1 + 0.2)).toBe(0.3);
        expect(round2(1.005)).toBe(1.01);
        expect(round2(928.59699999971963)).toBe(928.6);
    });

    it('produit des codes à 6 chiffres et des refresh tokens opaques', () => {
        expect(generateCode()).toMatch(/^\d{6}$/);
        const { token, hash } = buildRefreshToken('3f2b8a52-1111-4222-8333-444455556666');
        expect(sessionIdFromRefreshToken(token)).toBe('3f2b8a52-1111-4222-8333-444455556666');
        expect(hash).toBe(sha256(token));
        expect(sessionIdFromRefreshToken('n-importe-quoi')).toBeNull();
    });
});

describe('limiteur de débit', () => {
    it('bloque au-delà du quota puis se réarme', () => {
        const limiter = new RateLimit(2, 1000);
        expect(limiter.hit('ip', 0).ok).toBe(true);
        expect(limiter.hit('ip', 10).ok).toBe(true);
        expect(limiter.hit('ip', 20)).toEqual({ ok: false, retryAfter: 1 });
        expect(limiter.hit('autre', 20).ok).toBe(true);
        expect(limiter.hit('ip', 1001).ok).toBe(true);
    });

    it('purge les entrées expirées pour ne pas fuir en mémoire', () => {
        const limiter = new RateLimit(1, 1000);
        for (let i = 0; i < 100; i++) limiter.hit(`ip-${i}`, 0);
        expect(limiter.size).toBe(100);
        limiter.sweep(2000);
        expect(limiter.size).toBe(0);
    });
});

describe('configuration', () => {
    const base = { ACCESS_TOKEN_SECRET: 'x'.repeat(40), DATABASE_URL: 'postgres://u:p@h/db' };

    it('refuse de démarrer en production avec un secret faible ou sans base', () => {
        expect(() => loadEnv({ ...base, NODE_ENV: 'production', ACCESS_TOKEN_SECRET: 'court' })).toThrow(/32 caractères/);
        expect(() => loadEnv({ NODE_ENV: 'production', ACCESS_TOKEN_SECRET: base.ACCESS_TOKEN_SECRET })).toThrow(/base de données/);
        expect(() => loadEnv({})).toThrow(/ACCESS_TOKEN_SECRET/);
    });

    it('applique des valeurs par défaut sûres', () => {
        const env = loadEnv({ ...base, NODE_ENV: 'production' });
        expect(env).toMatchObject({ PORT: 3000, TRUST_PROXY: false, APP_TIMEZONE: 'Europe/Paris' });
        expect(env.ALLOWED_ORIGINS).toBeUndefined();
    });
});

describe('socle HTTP', () => {
    it('expose l’état de santé et la documentation OpenAPI', async () => {
        const health = await app.request('/health');
        expect(health.status).toBe(200);
        expect(await health.json()).toMatchObject({ status: 'ok', database: 'connected' });

        const doc = await anonymous('GET', '/openapi.json');
        expect(doc.status).toBe(200);
        expect(Object.keys(doc.body.paths).length).toBeGreaterThan(40);
    });

    it('n’autorise aucune origine navigateur par défaut et pose les en-têtes de sécurité', async () => {
        const res = await app.request('/health', { headers: { Origin: 'https://evil.example' } });
        expect(res.headers.get('access-control-allow-origin')).toBeNull();
        expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    });

    it('répond proprement aux routes inconnues et au JSON invalide', async () => {
        expect((await app.request('/api/v1/nope')).status).toBe(404);
        const res = await app.request('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
        expect(res.status).toBe(400);
    });
});
