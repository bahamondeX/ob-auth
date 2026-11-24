import { defineConfig, devices } from '@playwright/test'

const external = process.env.OB_AUTH_E2E_PORTAL_URL
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  use: { baseURL: external || 'http://localhost:3000' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: external ? undefined : {
    command: 'pnpm dev --host localhost --port 3000',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  }
})
