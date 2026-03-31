import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: 'tests',
    timeout: 90_000,        // Pyodide boot takes time
    use: {
        baseURL: 'http://localhost:5173',
    },
    webServer: {
        command: 'npx vite --port 5173',
        port: 5173,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
    },
});
