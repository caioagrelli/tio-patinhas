import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
const verifyUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
// Without both keys the check is off (local development and automated tests).
export const turnstileSiteKey = () => (process.env.TURNSTILE_SECRET_KEY && process.env.TURNSTILE_SITE_KEY) || null;
export async function verifyTurnstile(token: unknown) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret || !process.env.TURNSTILE_SITE_KEY) return;
  if (typeof token !== 'string' || !token || token.length > 2048)
    throw new BadRequestException('Confirme a verificação de segurança.');
  let result: { success?: boolean };
  try {
    const response = await fetch(verifyUrl, {
      method: 'POST',
      body: new URLSearchParams({ secret, response: token }),
      signal: AbortSignal.timeout(10_000),
    });
    result = (await response.json()) as { success?: boolean };
  } catch {
    throw new ServiceUnavailableException('Verificação de segurança indisponível. Tente novamente.');
  }
  if (result.success !== true) throw new BadRequestException('Verificação de segurança falhou. Tente novamente.');
}
