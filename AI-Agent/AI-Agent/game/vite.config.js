import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
    root: resolve(__dirname, './'),
    build: {
        outDir: resolve(__dirname, 'dist'),
        rollupOptions: {
            input: resolve(__dirname, 'index.html')
        }
    },
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: resolve(__dirname, 'tests/setup.js'),
        include: ['tests/**/*.test.js']
    }
});