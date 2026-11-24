<script setup lang="ts">
import { Eye, EyeOff, LockKeyhole } from 'lucide-vue-next'

defineProps<{
  id: string
  label: string
  showLabel: string
  hideLabel: string
  placeholder: string
  newPassword?: boolean
  disabled?: boolean
}>()
const model = defineModel<string>({ required: true })
const visible = ref(false)
</script>

<template>
  <div class="form-field">
    <div class="field-label-row">
      <label :for="id">{{ label }}</label>
      <slot />
    </div>
    <div class="input-shell">
      <LockKeyhole :size="17" aria-hidden="true" />
      <input :id="id" v-model="model" :name="id" :type="visible ? 'text' : 'password'"
        :autocomplete="newPassword ? 'new-password' : 'current-password'" :placeholder="placeholder"
        :minlength="newPassword ? 12 : undefined" :maxlength="256" :disabled="disabled" required>
      <UButton type="button" variant="ghost" color="neutral" class="password-toggle"
        :aria-label="visible ? hideLabel : showLabel" :aria-pressed="visible" @click="visible = !visible">
        <EyeOff v-if="visible" :size="17" aria-hidden="true" />
        <Eye v-else :size="17" aria-hidden="true" />
      </UButton>
    </div>
  </div>
</template>
