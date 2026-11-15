import { defineConfig } from 'vitest/config';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://moneo_test:moneo_test@127.0.0.1:54329/moneo_test';

export default defineConfig({
    test: {
        include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
        globalSetup: ['test/globalSetup.ts'],
        testTimeout: 20_000,
        hookTimeout: 120_000,
        env: {
            NODE_ENV: 'test',
            DATABASE_URL: TEST_DATABASE_URL,
            ACCESS_TOKEN_SECRET: 'test-secret-test-secret-test-secret-test',
            APP_TIMEZONE: 'Europe/Paris',
            LOG_LEVEL: process.env.LOG_LEVEL ?? 'silent',
        },
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/services/push.ts', 'src/services/mailer.ts', 'src/services/jobs.ts', 'src/config/**'],
            reporter: ['text', 'json', 'html', 'lcov'],
            thresholds: { lines: 70, functions: 70, branches: 55, statements: 70 },
        },
    },
});
