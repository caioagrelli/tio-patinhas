// Tests never talk to real outside services, even when the developer's .env has their keys:
// variables defined here (even empty) are not overridden by dotenv or Prisma loading .env later.
for (const name of [
  'SMTP_URL',
  'EMAIL_FROM',
  'TURNSTILE_SITE_KEY',
  'TURNSTILE_SECRET_KEY',
  'ANTHROPIC_API_KEY',
  'MERCADOPAGO_ACCESS_TOKEN',
  'MERCADOPAGO_PUBLIC_KEY',
  'MERCADOPAGO_WEBHOOK_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
])
  process.env[name] = '';
