import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: [
                'src/**/*.test.ts',
                'src/**/*.definitions.ts',
                'src/index.ts',
            ],
            reporter: ['text', 'json', 'html'],
            thresholds: {
                lines: 50,
                functions: 50,
                branches: 40,
                statements: 50,
            },
        },
    },
});
