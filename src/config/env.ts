import { z } from 'zod';

// Une variable vide (ex. `TRUST_PROXY=` écrite par le CI quand la variable GitHub n'est pas définie)
// est traitée comme absente → false.
const bool = z
    .preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.enum(['true', 'false', '1', '0']).optional())
    .transform((v) => v === 'true' || v === '1');

const schema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),

    DATABASE_URL: z.string().optional(),
    POSTGRES_USER: z.string().optional(),
    POSTGRES_PASSWORD: z.string().optional(),
    POSTGRES_DB: z.string().optional(),
    DB_HOST: z.string().default('db'),
    DB_PORT: z.coerce.number().int().default(5432),
    DB_SSL: bool,

    ACCESS_TOKEN_SECRET: z.string().min(1, 'ACCESS_TOKEN_SECRET est requis'),
    /** Origines CORS autorisées, séparées par des virgules. Vide = aucune origine navigateur. */
    ALLOWED_ORIGINS: z.string().optional(),
    /** À activer uniquement derrière un reverse proxy qui écrit X-Forwarded-For. */
    TRUST_PROXY: bool,
    APP_TIMEZONE: z.string().default('Europe/Paris'),
    PUBLIC_API_URL: z.string().default('https://moneo-app.com/api/v1'),

    GOOGLE_CLIENT_ID: z.string().optional(),
    BREVO_API_KEY: z.string().optional(),
    SMTP_FROM: z.string().default('noreply@moneo-app.com'),

    R2_ACCOUNT_ID: z.string().optional(),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional(),
    R2_BUCKET_NAME: z.string().optional(),
    R2_PUBLIC_URL: z.string().optional(),

    FIREBASE_SERVICE_ACCOUNT: z.string().optional(),
    UPTIME_PUSH_URL: z.string().optional(),
    SENTRY_DSN: z.string().optional(),
    LOG_LEVEL: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

export const loadEnv = (source: NodeJS.ProcessEnv = process.env): Env => {
    const parsed = schema.safeParse(source);
    if (!parsed.success) {
        const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
        throw new Error(`Configuration invalide — ${details}`);
    }
    const env = parsed.data;
    if (env.NODE_ENV === 'production') {
        if (env.ACCESS_TOKEN_SECRET.length < 32) {
            throw new Error('Configuration invalide — ACCESS_TOKEN_SECRET doit faire au moins 32 caractères en production');
        }
        if (!env.DATABASE_URL && !(env.POSTGRES_USER && env.POSTGRES_PASSWORD && env.POSTGRES_DB)) {
            throw new Error('Configuration invalide — base de données non configurée');
        }
    }
    return env;
};

export const env: Env = loadEnv();
