export default defineNuxtConfig({
  modules: ['@oscarbahamonde/ob-auth'],
  obAuth: {
    domain: 'http://localhost:3000',
    clientId: 'example-nuxt',
    appOrigin: 'http://localhost:3101',
  },
  routeRules: { '/**': { headers: { 'Cache-Control': 'private, no-store' } } },
  typescript: { strict: true },
  devtools: { enabled: false },
})
