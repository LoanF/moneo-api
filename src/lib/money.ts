/** Arrondi monétaire à 2 décimales, sans les artefacts binaires (1.005 → 1.01). */
export const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export const toNumber = (value: unknown): number => (value === null || value === undefined ? 0 : round2(Number(value)));
