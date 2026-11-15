import { unzipSync, strFromU8 } from 'fflate';
import { badRequest } from '../lib/errors.js';

/**
 * Lecteur minimal de classeurs .xlsx / .xlsm : valeurs des cellules uniquement
 * (les formules sont lues par leur dernier résultat calculé). Les macros ne sont jamais exécutées.
 */

export type CellValue = string | number | boolean | null;
export type Sheet = { name: string; cell(ref: string): CellValue; rows: Map<number, Map<string, CellValue>>; maxRow: number };

const MAX_UNCOMPRESSED_BYTES = 80 * 1024 * 1024;

const decodeXml = (s: string) =>
    s
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
        .replace(/_x([0-9A-F]{4})_/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
        .replace(/&amp;/g, '&');

const attr = (tag: string, name: string): string | undefined => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

export const readWorkbook = (data: Uint8Array): Map<string, Sheet> => {
    let total = 0;
    let files: Record<string, Uint8Array>;
    try {
        files = unzipSync(data, {
            filter: (file) => {
                // Seules les parties utiles sont décompressées, avec un plafond contre les bombes zip.
                const wanted = /^xl\/(workbook\.xml|sharedStrings\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml)$/.test(file.name);
                if (!wanted) return false;
                total += file.originalSize;
                if (total > MAX_UNCOMPRESSED_BYTES) throw new Error('too large');
                return true;
            },
        });
    } catch {
        throw badRequest('Fichier illisible : un classeur Excel (.xlsx ou .xlsm) est attendu');
    }
    const text = (path: string) => (files[path] ? strFromU8(files[path]) : null);

    const workbook = text('xl/workbook.xml');
    const rels = text('xl/_rels/workbook.xml.rels');
    if (!workbook || !rels) throw badRequest('Fichier illisible : un classeur Excel (.xlsx ou .xlsm) est attendu');

    const shared: string[] = [];
    for (const si of (text('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)) {
        // Les annotations phonétiques (<rPh>) ne font pas partie du texte.
        const body = si[1].replace(/<rPh[\s\S]*?<\/rPh>/g, '');
        shared.push(decodeXml([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join('')));
    }

    const targets = new Map<string, string>();
    for (const rel of rels.matchAll(/<Relationship\s[^>]*>/g)) {
        const id = attr(rel[0], 'Id');
        const target = attr(rel[0], 'Target');
        if (id && target) targets.set(id, target.replace(/^\/?xl\//, '').replace(/^\//, ''));
    }

    const sheets = new Map<string, Sheet>();
    for (const tag of workbook.matchAll(/<sheet\s[^>]*>/g)) {
        const name = decodeXml(attr(tag[0], 'name') ?? '');
        const target = targets.get(attr(tag[0], 'r:id') ?? '');
        const xml = target ? text(`xl/${target}`) : null;
        if (!xml) continue;

        const rows = new Map<number, Map<string, CellValue>>();
        let maxRow = 0;
        for (const row of xml.matchAll(/<row\s[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
            if (!row[1]) continue;
            for (const cell of row[1].matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
                const ref = /(?:^|\s)r="([A-Z]+)(\d+)"/.exec(cell[1]);
                if (!ref || cell[2] === undefined) continue;
                const type = /(?:^|\s)t="(\w+)"/.exec(cell[1])?.[1];
                const raw = /<v>([\s\S]*?)<\/v>/.exec(cell[2])?.[1];
                let value: CellValue = null;
                if (type === 'inlineStr') value = decodeXml(/<t[^>]*>([\s\S]*?)<\/t>/.exec(cell[2])?.[1] ?? '');
                else if (raw === undefined) continue;
                else if (type === 's') value = shared[Number(raw)] ?? '';
                else if (type === 'str' || type === 'e') value = decodeXml(raw);
                else if (type === 'b') value = raw === '1';
                else value = Number(raw);
                if (value === '' || value === null) continue;

                const rowNumber = Number(ref[2]);
                const line = rows.get(rowNumber) ?? new Map<string, CellValue>();
                line.set(ref[1], value);
                rows.set(rowNumber, line);
                if (rowNumber > maxRow) maxRow = rowNumber;
            }
        }
        sheets.set(name, {
            name,
            rows,
            maxRow,
            cell: (ref) => {
                const m = /^([A-Z]+)(\d+)$/.exec(ref);
                return m ? (rows.get(Number(m[2]))?.get(m[1]) ?? null) : null;
            },
        });
    }
    return sheets;
};

/** Lettres de colonnes Excel, de `from` à `to` inclus (A, B, …, Z, AA, …). */
export const columnRange = (from: string, to: string): string[] => {
    const toIndex = (col: string) => [...col].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
    const toName = (index: number) => {
        let name = '';
        for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
        return name;
    };
    return Array.from({ length: toIndex(to) - toIndex(from) + 1 }, (_, i) => toName(toIndex(from) + i));
};
