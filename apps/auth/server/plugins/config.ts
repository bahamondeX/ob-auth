import { loadConfig } from '../utils/config'

export default defineNitroPlugin(() => {
  if (process.env.VERCEL_ENV === 'production' || process.env.OB_AUTH_REQUIRE_CONFIG === 'true') loadConfig()
})
