/** Central, typed access to environment variables. Missing required vars throw at first use, not at import. */

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}
function opt(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const env = {
  get supabaseUrl() { return req("SUPABASE_URL"); },
  get supabaseServiceKey() { return req("SUPABASE_SERVICE_ROLE_KEY"); },
  get appApiKey() { return req("APP_API_KEY"); },
  get cronSecret() { return opt("CRON_SECRET"); },
  get dashboardPassword() { return opt("DASHBOARD_PASSWORD"); },

  get twilioSid() { return opt("TWILIO_ACCOUNT_SID"); },
  get twilioToken() { return opt("TWILIO_AUTH_TOKEN"); },
  get anthropicKey() { return opt("ANTHROPIC_API_KEY"); },

  get telegramToken() { return opt("TELEGRAM_BOT_TOKEN"); },
  get telegramChatId() { return opt("TELEGRAM_CHAT_ID"); },
  get telegramWebhookSecret() { return opt("TELEGRAM_WEBHOOK_SECRET"); },

  get lobKey() { return opt("LOB_API_KEY"); },
  get lobCertifiedCents() { return Number(opt("LOB_CERTIFIED_LETTER_CENTS", "900")); },
  get resendKey() { return opt("RESEND_API_KEY"); },
  get resendFrom() { return opt("RESEND_FROM"); },

  get publicBaseUrl() { return opt("PUBLIC_BASE_URL", "http://localhost:3000"); },

  user: {
    get fullName() { return opt("USER_FULL_NAME", "Consumer"); },
    get phone() { return opt("USER_PHONE"); },
    get email() { return opt("USER_EMAIL"); },
    get line1() { return opt("USER_ADDRESS_LINE1"); },
    get line2() { return opt("USER_ADDRESS_LINE2"); },
    get city() { return opt("USER_CITY"); },
    get state() { return opt("USER_STATE", "AZ"); },
    get zip() { return opt("USER_ZIP"); },
    get county() { return opt("USER_COUNTY", "Maricopa"); },
  },
};
