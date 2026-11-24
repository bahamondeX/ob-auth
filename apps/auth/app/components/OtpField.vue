<script setup lang="ts">
const props = defineProps<{ label: string, countdown?: string, disabled?: boolean }>()
const model = defineModel<string>({ required: true })
const field = ref<HTMLInputElement | null>(null)
const seconds = ref(30)
let timer: ReturnType<typeof setInterval> | undefined

function updateTimer() {
  seconds.value = 30 - (Math.floor(Date.now() / 1000) % 30)
}

onMounted(() => {
  if (!props.disabled) field.value?.focus()
  if (props.countdown) {
    updateTimer()
    timer = setInterval(updateTimer, 250)
  }
})
watch(() => props.disabled, (disabled) => {
  if (!disabled) field.value?.focus()
}, { flush: 'post' })
onUnmounted(() => {
  if (timer) clearInterval(timer)
})

function updateCode(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  input.value = input.value.replace(/\D/g, '').slice(0, 6)
  model.value = input.value
}

function pasteCode(event: ClipboardEvent) {
  const digits = event.clipboardData?.getData('text').replace(/\D/g, '').slice(0, 6)
  if (!digits) return
  event.preventDefault()
  model.value = digits
}
</script>

<template>
  <div class="form-field">
    <label for="auth-code">{{ label }}</label>
    <input id="auth-code" ref="field" class="code-input" name="code" type="text"
      inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code" maxlength="6"
      placeholder="000000" :value="model" :disabled="disabled" required
      @input="updateCode" @paste="pasteCode">
    <div v-if="countdown" class="code-timer">
      <progress :aria-label="countdown" :value="seconds" max="30" />
      <span aria-hidden="true">{{ seconds }}s</span>
    </div>
  </div>
</template>
