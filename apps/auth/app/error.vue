<script setup lang="ts">
const locale = useCookie('ob-locale')
const spanish = computed(() => locale.value === 'es')
useHead({
  title: 'OB Auth',
  htmlAttrs: { lang: computed(() => spanish.value ? 'es' : 'en') }
})
</script>

<template>
  <main class="portal-error">
    <img src="/favicon.png" width="64" height="64" alt="OB Auth">
    <h1>{{ spanish ? 'No pudimos completar la solicitud' : 'We couldn’t complete the request' }}</h1>
    <p>{{ spanish ? 'Vuelve a empezar desde tu aplicación o regresa a OB Auth.' : 'Start again from your application or return to OB Auth.' }}</p>
    <a href="/">{{ spanish ? 'Volver a OB Auth' : 'Return to OB Auth' }}</a>
  </main>
</template>

<style>
.portal-error { min-height: 100vh; display: grid; place-content: center; justify-items: center; gap: 1rem; padding: 2rem; text-align: center; background: #0c1019; color: #f8fafc; }
.portal-error h1 { font-size: 1.65rem; font-weight: 680; }
.portal-error p { color: #bec6d5; }
.portal-error a { color: #b4dcff; text-decoration: underline; }
</style>
