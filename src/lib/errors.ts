export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429;

/** Erreur métier renvoyée telle quelle au client ({ error: message }). */
export class HttpError extends Error {
    constructor(
        public readonly status: ErrorStatus,
        message: string,
        public readonly code?: string,
    ) {
        super(message);
        this.name = 'HttpError';
    }
}

export const badRequest = (message: string, code?: string) => new HttpError(400, message, code);
export const unauthorized = (message = 'Authentification requise', code?: string) => new HttpError(401, message, code);
export const notFound = (message = 'Ressource introuvable') => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);
