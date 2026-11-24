<script setup lang="ts">
import {
  ArrowLeft, ArrowRight, ArrowUpRight, Check, ChevronDown, CircleAlert, Globe2, KeyRound, LockKeyhole,
  Mail, Monitor, Moon, ShieldCheck, Sun, UserRound,
} from 'lucide-vue-next'
import { messages, type CopyKey, type Locale } from './utils/copy'

type Screen = 'signin' | 'signup' | 'confirm' | 'forgot' | 'reset' | 'enroll' | 'totp' | 'recovery'
  | 'profile' | 'security' | 'sessions' | 'password' | 'new_password' | 'link' | 'logout' | 'approve' | 'redirect'
type Provider = 'google' | 'microsoft' | 'github'
type Session = {
  user: null | { sub: string, email?: string, emailVerified: boolean, provider: string, mfa: boolean }
  providers: string[]
  sessions?: Array<{ id: string, current: boolean, createdAt: string | number, lastSeen: string | number }>
  application?: { name: string, logo?: string }
  logout?: boolean
}
type AuthResult = {
  step?: 'authenticated' | 'totp' | 'enroll' | 'confirm' | 'new_password'
  secret?: string
  otpauth?: string
  next?: string
}
type Status = { statusCode?: number, status?: number, response?: { status?: number } }

const route = useRoute()
const router = useRouter()
const locale = useCookie<Locale>('ob-locale', { default: () => 'en', sameSite: 'lax', maxAge: 31536000 })
const theme = useCookie<'dark' | 'light'>('ob-theme', { default: () => 'dark', sameSite: 'lax', maxAge: 31536000 })
const language = computed<Locale>(() => locale.value === 'es' ? 'es' : 'en')
const dark = computed(() => theme.value !== 'light')
const t = (key: CopyKey) => messages[language.value][key]

useHead({
  title: 'OB Auth | Oscar Bahamonde',
  htmlAttrs: { lang: language, 'data-theme': computed(() => dark.value ? 'dark' : 'light') },
  link: [{ rel: 'icon', type: 'image/png', href: '/favicon.png' }],
})
useSeoMeta({ description: () => t('heroDescription'), robots: 'noindex, nofollow' })

const screen = ref<Screen>('signin')
const session = ref<Session>({ user: null, providers: [] })
const email = ref('')
const password = ref('')
const oldPassword = ref('')
const linkProvider = ref<Provider>('google')
const code = ref('')
const secret = ref('')
const qrImage = ref('')
const qrFailed = ref(false)
const loading = ref(false)
const hydrated = ref(false)
const notice = ref<CopyKey>()
const error = ref<CopyKey>()
const titleEl = ref<HTMLElement>()
const providers: Provider[] = ['google', 'github', 'microsoft']
const handledQueryError = typeof route.query.error === 'string'
const handledLinkReturn = route.query.linked === '1'
if (handledQueryError) error.value = 'federationFailed'

const titles: Record<Screen, CopyKey> = {
  signin: 'welcome', signup: 'createAccount', confirm: 'confirmEmail', forgot: 'forgot', reset: 'reset',
  enroll: 'enroll', totp: 'totp', recovery: 'recovery', profile: 'profile', security: 'security',
  sessions: 'sessions', password: 'changePassword', new_password: 'updateTemporary', link: 'linkAccounts',
  logout: 'signOutTitle', approve: 'approve', redirect: 'signingIn',
}
const descriptions: Partial<Record<Screen, CopyKey>> = {
  signin: 'welcomeDescription', signup: 'registrationDescription', confirm: 'confirmDescription',
  forgot: 'forgotDescription', reset: 'resetDescription', enroll: 'enrollDescription', totp: 'totpDescription',
  recovery: 'recoveryDescription', profile: 'profileDescription', sessions: 'sessionsDescription',
  logout: 'signOutDescription', approve: 'approvalDescription', redirect: 'redirecting',
  new_password: 'updateTemporaryDescription', link: 'linkDescription',
}
const forms: Screen[] = ['signin', 'signup', 'confirm', 'forgot', 'reset', 'enroll', 'totp', 'password', 'new_password', 'link']
const withEmail: Screen[] = ['signin', 'signup', 'confirm', 'forgot', 'reset']
const withNewPassword: Screen[] = ['signup', 'reset', 'password', 'new_password']
const withCode: Screen[] = ['confirm', 'reset', 'enroll', 'totp']
const accountSettings: Screen[] = ['profile', 'security', 'sessions']
const submitText: Partial<Record<Screen, CopyKey>> = {
  signin: 'signIn', signup: 'createAccount', confirm: 'verify', forgot: 'sendCode', reset: 'reset',
  enroll: 'verify', totp: 'verify', password: 'changePassword', new_password: 'continue', link: 'linkStart',
}

const screenCopy = computed(() => {
  const description = descriptions[screen.value]
  return description ? t(description) : ''
})
const mainAction = computed(() => t(submitText[screen.value] ?? 'continue'))
const mfaScreen = computed(() => screen.value === 'totp' || screen.value === 'enroll')
const providerNames: Record<Provider, string> = { google: 'Google', github: 'GitHub', microsoft: 'Microsoft' }
const enabledProviders = computed(() => providers.filter(provider => provider !== 'microsoft' && session.value.providers.includes(provider)))
const nativeAccount = computed(() => session.value.user?.provider === 'password')
const currentProvider = computed(() => {
  const name = session.value.user?.provider.toLowerCase() ?? 'native'
  return name in providerNames ? providerNames[name as Provider] : t('native')
})

function show(next: Screen, message?: CopyKey) {
  if (next !== screen.value) {
    password.value = ''
    oldPassword.value = ''
    code.value = ''
    if (next !== 'enroll') {
      secret.value = ''
      qrImage.value = ''
      qrFailed.value = false
    }
  }
  screen.value = next
  notice.value = message
  error.value = undefined
  if (!withCode.includes(next)) void nextTick(() => titleEl.value?.focus())
}

function errorKey(cause: unknown): CopyKey {
  const failure = cause as Status | undefined
  const status = failure?.response?.status ?? failure?.statusCode ?? failure?.status
  if (!status) return 'offline'
  if (status === 429) return 'rateLimited'
  if (status === 401 || status === 400 || status === 422) return 'badCredentials'
  if (status === 403) return 'forbidden'
  if (status === 410) return 'requestExpired'
  return 'genericError'
}

async function run(action: () => Promise<void>) {
  if (loading.value) return
  loading.value = true
  error.value = undefined
  notice.value = undefined
  try {
    await action()
  } catch (cause) {
    error.value = errorKey(cause)
  } finally {
    loading.value = false
  }
}

function post<T = AuthResult>(action: string, body: Record<string, string> = {}) {
  return $fetch<T>('/api/auth/' + action, { method: 'POST', body })
}

async function readSession(pickScreen = false) {
  session.value = await $fetch<Session>('/api/auth/session')
  if (!pickScreen) return
  if (session.value.logout || route.query.view === 'logout') show('logout')
  else if (session.value.user) show(session.value.application ? 'approve' : 'profile')
}

function redirectTo(next: string) {
  const target = new URL(next, window.location.origin)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
  if (target.protocol !== 'https:' && !(target.protocol === 'http:' && loopback)) {
    throw createError({ statusCode: 403 })
  }
  show('redirect')
  window.location.assign(target.href)
}

async function advance(result: AuthResult) {
  if (result.next) {
    redirectTo(result.next)
    return
  }
  switch (result.step) {
    case 'totp':
      show('totp')
      return
    case 'enroll': {
      show('enroll')
      secret.value = result.secret ?? ''
      try {
        if (!result.otpauth?.startsWith('otpauth://totp/')) throw new Error('Missing enrollment URI')
        const QRCode = await import('qrcode')
        const image = await QRCode.toDataURL(result.otpauth, { width: 176, margin: 2, errorCorrectionLevel: 'M' })
        if (screen.value === 'enroll') qrImage.value = image
      } catch {
        qrFailed.value = true
      }
      return
    }
    case 'confirm':
      show('confirm')
      return
    case 'new_password':
      show('new_password')
      return
    case 'authenticated':
      await readSession(true)
      return
    default:
      throw createError({ statusCode: 502 })
  }
}

function federate(provider: Provider) {
  return run(async () => {
    const { next } = await post('federate/' + provider)
    if (!next) throw createError({ statusCode: 502 })
    redirectTo(next)
  })
}

function submit() {
  return run(async () => {
    const address = email.value.trim()
    const submittedPassword = password.value
    const previousPassword = oldPassword.value
    password.value = ''
    oldPassword.value = ''
    switch (screen.value) {
      case 'signin':
        await advance(await post('signin', { email: address, password: submittedPassword }))
        break
      case 'signup':
        await post('signup', { email: address, password: submittedPassword })
        show('confirm')
        break
      case 'confirm':
        await post('confirm', { email: address, code: code.value })
        show('signin', 'confirmed')
        break
      case 'forgot':
        await post('forgot', { email: address })
        show('reset')
        break
      case 'reset':
        await post('reset', { email: address, password: submittedPassword, code: code.value })
        show('signin', 'resetComplete')
        break
      case 'enroll':
      case 'totp':
        try {
          await advance(await post('challenge', { code: code.value }))
        } finally {
          code.value = ''
        }
        break
      case 'new_password':
        await advance(await post('challenge', { password: submittedPassword }))
        break
      case 'link':
        await advance(await post('link', { provider: linkProvider.value, password: previousPassword }))
        break
      case 'password':
        await post('password', { oldPassword: previousPassword, password: submittedPassword })
        await readSession()
        show('signin', 'passwordChanged')
        break
    }
  })
}

function resend() {
  const address = email.value.trim()
  if (!address) return
  return run(async () => {
    await post('resend', { email: address })
    notice.value = 'resent'
  })
}

function approve() {
  return run(async () => {
    const { next } = await post('approve')
    if (!next) throw createError({ statusCode: 502 })
    redirectTo(next)
  })
}

function cancelRequest() {
  return run(async () => {
    await post('cancel')
    if (route.query.view === 'logout') await router.replace({ query: {} })
    await readSession(false)
    show(session.value.user ? 'profile' : 'signin')
  })
}

function signOut() {
  return run(async () => {
    const { next } = await post('logout')
    session.value = { user: null, providers: session.value.providers }
    email.value = ''
    if (next) redirectTo(next)
    else show('signin', 'signedOut')
  })
}

function revoke(id: string, current: boolean) {
  return run(async () => {
    await post('revoke', { id })
    await readSession(false)
    if (current || !session.value.user) show('signin', 'signedOut')
    else notice.value = 'revoked'
  })
}

function openLink() {
  const first = enabledProviders.value[0]
  if (!first) return
  linkProvider.value = first
  show('link')
}

function formatDate(value: string | number) {
  const date = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(language.value, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

onMounted(async () => {
  hydrated.value = true
  if (handledQueryError || handledLinkReturn) {
    const query = { ...route.query }
    delete query.error
    delete query.linked
    await router.replace({ query })
  }
  try {
    await readSession(!handledQueryError && screen.value === 'signin' && !loading.value)
  } catch (cause) {
    error.value ??= errorKey(cause)
  }
})
</script>

<template>
  <UApp>
    <a class="skip-link" href="#auth-content">{{ t('skip') }}</a>
    <div class="portal-shell">
      <BrandPanel :first="t('heroFirst')" :second="t('heroSecond')" :description="t('heroDescription')"
        :portfolio="t('portfolio')" :portal="t('portal')" />
      <main id="auth-content" class="auth-panel" tabindex="-1">
        <div class="auth-toolbar">
          <div class="language-control">
            <Globe2 :size="16" aria-hidden="true" />
            <select v-model="locale" :aria-label="t('language')" :disabled="!hydrated">
              <option value="en" lang="en">EN</option>
              <option value="es" lang="es">ES</option>
            </select>
            <ChevronDown :size="13" aria-hidden="true" />
          </div>
          <UButton type="button" color="neutral" variant="ghost" class="theme-control"
            :aria-label="dark ? t('themeLight') : t('themeDark')" :disabled="!hydrated"
            @click="theme = dark ? 'light' : 'dark'">
            <Sun v-if="dark" :size="18" aria-hidden="true" />
            <Moon v-else :size="18" aria-hidden="true" />
          </UButton>
        </div>

        <div class="auth-center">
          <section class="auth-card" aria-labelledby="screen-title">
            <div v-if="session.application && screen !== 'profile'" class="destination">
              <img v-if="session.application.logo" :src="session.application.logo" width="20" height="20" alt="">
              <ArrowUpRight v-else :size="16" aria-hidden="true" />
              <span>{{ t('destination') }} <strong>{{ session.application.name }}</strong></span>
            </div>

            <div class="screen-icon" aria-hidden="true">
              <LockKeyhole v-if="screen === 'signin'" :size="22" :stroke-width="1.7" />
              <Mail v-else-if="screen === 'confirm' || screen === 'forgot'" :size="22" :stroke-width="1.7" />
              <KeyRound v-else-if="mfaScreen || screen === 'reset' || screen === 'password'" :size="22" :stroke-width="1.7" />
              <UserRound v-else-if="screen === 'signup' || screen === 'profile'" :size="22" :stroke-width="1.7" />
              <Monitor v-else-if="screen === 'sessions'" :size="22" :stroke-width="1.7" />
              <ShieldCheck v-else :size="22" :stroke-width="1.7" />
            </div>
            <header class="screen-header">
              <h2 id="screen-title" ref="titleEl" tabindex="-1">{{ t(titles[screen]) }}</h2>
              <p v-if="screenCopy">{{ screenCopy }}</p>
            </header>

            <div v-if="error" class="feedback feedback-error" role="alert">
              <CircleAlert :size="17" aria-hidden="true" /><span>{{ t(error) }}</span>
            </div>
            <div v-if="notice" class="feedback feedback-success" role="status">
              <Check :size="17" aria-hidden="true" /><span>{{ t(notice) }}</span>
            </div>

            <form v-if="forms.includes(screen)" class="portal-form" method="post" @submit.prevent="submit">
            <fieldset :disabled="!hydrated" class="form-fields">
              <div v-if="withEmail.includes(screen)" class="form-field">
                <label for="email">{{ t('email') }}</label>
                <div class="input-shell">
                  <Mail :size="17" aria-hidden="true" />
                  <input id="email" v-model.trim="email" name="email" type="email" inputmode="email"
                    :autocomplete="screen === 'signin' ? 'username' : 'email'"
                    autocapitalize="none" spellcheck="false" :placeholder="t('emailPlaceholder')" :maxlength="254"
                    :disabled="loading" required>
                </div>
              </div>

              <div v-if="screen === 'enroll' && secret" class="qr-enrollment">
                <img v-if="qrImage" :src="qrImage" width="176" height="176" :alt="t('qr')">
                <p v-else-if="qrFailed">{{ t('qrError') }}</p>
                <details>
                  <summary>{{ t('manual') }}</summary>
                  <code class="setup-key">{{ secret }}</code>
                </details>
              </div>

              <OtpField v-if="withCode.includes(screen)" :key="screen" v-model="code"
                :label="t(mfaScreen ? 'totpCode' : screen === 'reset' ? 'resetCode' : 'emailCode')"
                :countdown="mfaScreen ? t('countdown') : undefined" :disabled="loading" />

              <div v-if="screen === 'link'" class="form-field">
                <label for="link-provider">{{ t('linkProvider') }}</label>
                <select id="link-provider" v-model="linkProvider" class="field-select" :disabled="loading" required>
                  <option v-for="provider in enabledProviders" :key="provider" :value="provider">{{ providerNames[provider] }}</option>
                </select>
              </div>

              <PasswordField v-if="screen === 'password' || screen === 'link'" id="old-password" v-model="oldPassword"
                :label="t('oldPassword')" :placeholder="t('passwordPlaceholder')" :show-label="t('showPassword')"
                :hide-label="t('hidePassword')" :disabled="loading" />
              <div v-if="screen === 'signin' || withNewPassword.includes(screen)">
                <PasswordField :key="screen" id="password" v-model="password"
                  :label="t(screen === 'reset' || screen === 'password' || screen === 'new_password' ? 'newPassword' : 'password')"
                  :placeholder="t('passwordPlaceholder')" :show-label="t('showPassword')"
                  :hide-label="t('hidePassword')" :new-password="withNewPassword.includes(screen)" :disabled="loading">
                  <button v-if="screen === 'signin'" class="text-action" type="button"
                    :disabled="loading" @click="show('forgot')">{{ t('forgotLink') }}</button>
                </PasswordField>
                <p v-if="withNewPassword.includes(screen)" class="field-hint">{{ t('passwordHint') }}</p>
              </div>

              <UButton type="submit" class="primary-action" :loading="loading" :disabled="loading">
                <span>{{ loading ? t('pending') : mainAction }}</span>
                <ArrowRight v-if="!loading" :size="17" aria-hidden="true" />
              </UButton>
            </fieldset>
            </form>

            <template v-if="screen === 'signin'">
              <div class="divider"><span>{{ t('providerSeparator') }}</span></div>
              <div class="provider-list">
                <template v-for="provider in providers" :key="provider">
                  <button v-if="session.providers.includes(provider)" type="button" class="provider-action" :disabled="loading" @click="federate(provider)">
                    <ProviderLogo :provider="provider" /><span>{{ t(provider) }}</span>
                  </button>
                  <button v-else type="button" class="provider-action unavailable-provider" :title="t('unavailable')"
                    :aria-label="t(provider) + ' · ' + t('unavailable')" disabled>
                    <ProviderLogo :provider="provider" /><span>{{ t(provider) }}</span>
                  </button>
                </template>
              </div>
              <div class="screen-footer">
                <span>{{ t('needAccount') }}</span>
                <button type="button" class="text-action" :disabled="!hydrated || loading" @click="show('signup')">{{ t('createAccount') }}</button>
              </div>
              <button type="button" class="text-action verify-link" :disabled="!hydrated || loading" @click="show('confirm')">{{ t('confirmEmail') }}</button>
            </template>

            <div v-else-if="screen === 'signup'" class="screen-footer">
              <span>{{ t('haveAccount') }}</span>
              <button type="button" class="text-action" :disabled="loading" @click="show('signin')">{{ t('signIn') }}</button>
            </div>
            <div v-else-if="['confirm', 'forgot', 'reset', 'enroll', 'totp', 'recovery', 'new_password'].includes(screen)" class="screen-footer">
              <button v-if="screen === 'confirm'" type="button" class="text-action" :disabled="loading" @click="resend">{{ t('resend') }}</button>
              <button v-if="mfaScreen" type="button" class="text-action" :disabled="loading" @click="show('recovery')">{{ t('recover') }}</button>
              <button type="button" class="text-action back-action" :disabled="loading" @click="show('signin')">
                <ArrowLeft :size="15" aria-hidden="true" />{{ t('back') }}
              </button>
            </div>

            <template v-if="session.user && accountSettings.includes(screen)">
              <nav class="account-nav" :aria-label="t('profile')">
                <button v-for="section in ['profile', 'security', 'sessions'] as const" :key="section" type="button"
                  :aria-current="screen === section ? 'page' : undefined"
                  :disabled="loading" @click="show(section)">{{ t(section) }}</button>
              </nav>

              <dl v-if="screen === 'profile'" class="profile-details">
                <div><dt>{{ t('email') }}</dt><dd>{{ session.user.email }}</dd></div>
                <div><dt>{{ t('confirmEmail') }}</dt><dd>{{ t(session.user.emailVerified ? 'verified' : 'unverified') }}</dd></div>
                <div><dt>{{ t('provider') }}</dt><dd>{{ currentProvider }}</dd></div>
              </dl>
              <div v-else-if="screen === 'security'" class="security-detail">
                <div><strong>{{ t('mfa') }}</strong><p>{{ t(session.user.mfa ? 'mfaVerified' : 'mfaUnverified') }}</p></div>
                <button v-if="nativeAccount" type="button" class="secondary-action"
                  :disabled="loading" @click="show('password')">{{ t('changePassword') }}</button>
                <button v-if="nativeAccount && session.user.mfa && enabledProviders.length" type="button" class="secondary-action"
                  :disabled="loading" @click="openLink">{{ t('linkAccounts') }}</button>
              </div>
              <ul v-else-if="session.sessions?.length" class="session-list">
                <li v-for="item in session.sessions" :key="item.id">
                  <Monitor :size="18" aria-hidden="true" />
                  <div><strong>{{ t(item.current ? 'currentSession' : 'otherSession') }}</strong><time>{{ formatDate(item.lastSeen) }}</time></div>
                  <button type="button" class="text-action" :disabled="loading"
                    @click="revoke(item.id, item.current)">{{ t('revoke') }}</button>
                </li>
              </ul>
              <p v-else>{{ t('none') }}</p>

              <button type="button" class="secondary-action" :disabled="loading" @click="show('logout')">{{ t('signOut') }}</button>
            </template>

            <button v-if="screen === 'password' || screen === 'link'" type="button" class="text-action back-action standalone-action"
              :disabled="loading" @click="show('security')"><ArrowLeft :size="15" aria-hidden="true" />{{ t('goAccount') }}</button>

            <div v-if="screen === 'logout'" class="paired-actions">
              <button type="button" class="secondary-action" :disabled="loading" @click="cancelRequest">{{ t('cancel') }}</button>
              <UButton type="button" class="primary-action" :loading="loading" :disabled="loading" @click="signOut">{{ t('signOut') }}</UButton>
            </div>

            <div v-if="screen === 'approve'" class="paired-actions">
              <button type="button" class="secondary-action" :disabled="loading" @click="cancelRequest">{{ t('cancel') }}</button>
              <UButton type="button" class="primary-action" :loading="loading" :disabled="loading" @click="approve">
                {{ t('continue') }} <ArrowRight :size="17" aria-hidden="true" />
              </UButton>
            </div>
          </section>
        </div>
      </main>
    </div>
  </UApp>
</template>
