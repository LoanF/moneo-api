import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: [
                'src/services/fcmService.ts',
                'src/services/messagingService.ts',
                'src/services/notificationScheduler.ts',
                'src/models/**',
                'src/utils/seeder.ts',
                'src/types.ts',
                'src/config/**',
                'src/**/*.test.ts',
                'src/**/*.definitions.ts',
                'src/index.ts',
            ],
            reporter: ['text', 'json', 'html', 'lcov'],
            thresholds: {
                lines: 50,
                functions: 50,
                branches: 40,
                statements: 50,
            },
        },
    },
});
