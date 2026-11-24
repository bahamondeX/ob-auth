export default defineNuxtConfig({
  compatibilityDate: '2026-07-15',
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  fonts: { providers: { google: false, googleicons: false, bunny: false, fontshare: false, fontsource: false, adobe: false } },
  colorMode: { preference: 'system', fallback: 'dark', classSuffix: '', storageKey: 'ob-auth-theme' },
  typescript: { strict: true },
  devtools: { enabled: false },
  app: {
    head: {
      title: 'OB Auth',
      meta: [{ name: 'robots', content: 'noindex, nofollow' }],
      link: [{ rel: 'icon', type: 'image/png', href: '/favicon.png' }]
    }
  }
})
