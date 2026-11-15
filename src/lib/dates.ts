import { env } from '../config/env.js';

/** Toutes les dates métier sont des chaînes ISO `YYYY-MM-DD`, les périodes des `YYYY-MM`. */

const pad = (n: number) => String(n).padStart(2, '0');

export const todayISO = (now: Date = new Date(), timeZone: string = env.APP_TIMEZONE): string =>
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

/** Heure locale `HH:MM` dans le fuseau de l'application. */
export const localTime = (now: Date = new Date(), timeZone: string = env.APP_TIMEZONE): string =>
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);

export const isISODate = (value: string): boolean => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};

export const periodOf = (date: string): string => date.slice(0, 7);

export const daysInMonth = (period: string): number => {
    const [y, m] = period.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

export const addMonths = (period: string, n: number): string => {
    const [y, m] = period.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};

export const addDays = (date: string, n: number): string => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
};

export const diffDays = (from: string, to: string): number =>
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Le 31 d'un mois de 30 jours devient le 30, le 30 février devient le dernier jour de février. */
export const clampDay = (period: string, day: number): string =>
    `${period}-${pad(Math.min(Math.max(1, day), daysInMonth(period)))}`;

export const monthNumber = (period: string): number => Number(period.slice(5, 7));

/** Période budgétaire contenant `date`, pour un mois qui démarre le `startDay` (1–28). */
export const budgetPeriod = (date: string, startDay = 1): { from: string; to: string } => {
    const day = Number(date.slice(8, 10));
    const startPeriod = day >= startDay ? periodOf(date) : addMonths(periodOf(date), -1);
    const from = clampDay(startPeriod, startDay);
    const to = addDays(clampDay(addMonths(startPeriod, 1), startDay), -1);
    return { from, to };
};

/** Numéro de série Excel (système 1900) → date ISO. */
export const excelSerialToISO = (serial: number): string =>
    new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000).toISOString().slice(0, 10);
