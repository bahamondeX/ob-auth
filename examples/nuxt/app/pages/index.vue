<script setup lang="ts">
const { user, pending, error, login, logout } = useAuth()
const logoutError = ref(false)
const ready = ref(false)
onMounted(() => { ready.value = true })
async function signOut(everywhere: boolean) {
  logoutError.value = false
  try {
    await logout({ everywhere })
  } catch {
    logoutError.value = true
  }
}
</script>

<template>
  <p v-if="pending">Checking your session…</p>
  <p v-else-if="error" role="alert">Could not check your session.</p>
  <template v-else-if="user">
    <p>Signed in as {{ user.email }}</p>
    <NuxtLink to="/protected">Protected page</NuxtLink>
    <button @click="signOut(false)">Sign out of this app</button>
    <button @click="signOut(true)">Sign out everywhere</button>
    <p v-if="logoutError" role="alert">Could not sign out.</p>
  </template>
  <button v-else :disabled="!ready" @click="login('/protected')">Sign in with OB Auth</button>
</template>
