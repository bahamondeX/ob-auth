<script setup lang="ts">
definePageMeta({ middleware: 'ob-auth' })
const { user } = useAuth()
</script>

<template>
  <h2>Protected page</h2>
  <p v-if="user">Your identity is {{ user.sub }}.</p>
  <NuxtLink to="/">Back</NuxtLink>
</template>
