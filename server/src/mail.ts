import { Injectable } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTransport, type Transporter } from 'nodemailer';

export type Email = { to: string; subject: string; text: string; html: string };

/** E-mails are sent when SMTP_URL is set (Gmail, Amazon SES, Resend, Brevo… all speak SMTP). */
export const mailEnabled = () => Boolean(process.env.SMTP_URL);
const appUrl = (path: string) => new URL(path, process.env.APP_URL || 'http://localhost:5173').toString();

const escape = (text: string) =>
  text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

type Message = {
  /** Small monospace line above the title, like the "// BEM-VINDO" of the login page. */
  eyebrow: string;
  title: string;
  /** Shown by the inbox next to the subject. */
  preview: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  footnote?: string;
};
const MONO = "ui-monospace,'SFMono-Regular','JetBrains Mono',Menlo,Consolas,'Liberation Mono',monospace";
const SANS = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/**
 * The look of the login page in an e-mail: dark page with pixel particles, banner with the crab and "CRAB FINANCE_",
 * dark card with the orange accent. Built with tables and inline styles, which every mail client understands;
 * texts and the button stay real text, so the message still reads with images blocked. Names are always escaped.
 */
function layout(m: Message) {
  const brandText = 'CRAB FINANCE_';
  const text = [
    brandText,
    '',
    m.title,
    '',
    ...m.paragraphs,
    ...(m.button ? ['', `${m.button.label}: ${m.button.url}`] : []),
    ...(m.footnote ? ['', m.footnote] : []),
  ].join('\n');
  const paragraphs = m.paragraphs
    .map(p => `<p style="margin:0 0 14px;font:15px/1.65 ${SANS};color:#b9bdb6">${escape(p)}</p>`)
    .join('');
  const button = m.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 8px"><tr><td bgcolor="#f64301" style="background-color:#f64301;border-radius:6px">
<a href="${escape(m.button.url)}" style="display:inline-block;padding:15px 28px;font:700 13px/1 ${MONO};letter-spacing:2px;text-transform:uppercase;color:#140b05;text-decoration:none">${escape(m.button.label)}</a>
</td></tr></table>
<p style="margin:14px 0 0;font:12px/1.6 ${SANS};color:#7d817a">Se o botão não funcionar, copie e cole este endereço no navegador:<br>
<a href="${escape(m.button.url)}" style="color:#f64301;word-break:break-all">${escape(m.button.url)}</a></p>`
    : '';
  const footnote = m.footnote
    ? `<p style="margin:22px 0 0;padding-top:18px;border-top:1px solid #232323;font:12px/1.6 ${SANS};color:#7d817a">${escape(m.footnote)}</p>`
    : '';
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${escape(m.title)}</title></head>
<body bgcolor="#08090d" style="margin:0;padding:0;background-color:#08090d">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escape(m.preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#08090d" background="${appUrl('/email/stars.png')}"
  style="background-color:#08090d;background-image:url('${appUrl('/email/stars.png')}');background-repeat:repeat"><tr><td align="center" bgcolor="#08090d" background="${appUrl('/email/stars.png')}" style="padding:28px 12px 36px;background-color:#08090d;background-image:url('${appUrl('/email/stars.png')}');background-repeat:repeat">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td><a href="${appUrl('/')}"><img src="cid:crab-header" width="600" alt="CRAB FINANCE_"
  style="display:block;width:100%;max-width:600px;height:auto;border:0;color:#ededed;font:700 22px ${MONO}"></a></td></tr>
<tr><td style="padding-top:18px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#0e1014" style="background-color:#0e1014;border:1px solid #232323;border-radius:10px">
<tr><td style="padding:0 0 0 28px"><div style="width:56px;height:2px;background-color:#f64301;font-size:0;line-height:0">&nbsp;</div></td></tr>
<tr><td style="padding:30px 32px 32px">
<p style="margin:0 0 12px;font:500 11px/1.4 ${MONO};letter-spacing:2px;text-transform:uppercase;color:#8f8f8f"><span style="color:#f64301">//</span> ${escape(m.eyebrow)}</p>
<h1 style="margin:0 0 18px;font:600 26px/1.25 ${SANS};letter-spacing:-0.5px;color:#ededed">${escape(m.title)}</h1>
${paragraphs}${button}${footnote}
</td></tr></table>
</td></tr>
<tr><td align="center" style="padding:26px 12px 0">
<img src="cid:crab-logo" width="40" alt="" style="display:block;margin:0 auto 10px;image-rendering:pixelated;border:0">
<p style="margin:0 0 6px;font:700 13px/1 ${MONO};letter-spacing:3px;color:#ededed">CRAB FINANCE<span style="color:#f64301">_</span></p>
<p style="margin:0;font:12px/1.6 ${SANS};color:#6f736c">Controle financeiro pessoal. Você recebeu este e-mail porque tem uma conta no CRAB FINANCE.</p>
</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}

/**
 * Banner and crab travel inside the e-mail (inline "cid:" images), so they show even when the message is sent from a
 * computer the mail client cannot reach, and without the "show images" prompt. Files come from the built site
 * (web-dist) in production and from web/public in development.
 */
function inlineImages() {
  const roots = [process.env.WEB_ROOT, 'web-dist', 'web/public'].filter((r): r is string => Boolean(r));
  const find = (file: string) => roots.map(r => resolve(r, file)).find(path => existsSync(path));
  return [
    { cid: 'crab-header', filename: 'crab-finance.png', path: find('email/header.png') },
    { cid: 'crab-logo', filename: 'caranguejo.png', path: find('logo.png') },
  ].filter((a): a is { cid: string; filename: string; path: string } => Boolean(a.path));
}

/** The messages the app sends; each returns subject, plain text and HTML. */
export const emails = {
  welcomeGoogle: (name: string) => ({
    subject: 'Bem-vindo ao CRAB FINANCE 🦀',
    ...layout({
      eyebrow: 'Bem-vindo ao seu controle financeiro',
      title: `Olá, ${name}! Sua conta está pronta.`,
      preview: 'Sua conta está pronta e você tem 1 mês grátis.',
      paragraphs: [
        'Você entrou com o Google, então não precisa de senha: é só usar o botão "Continuar com Google".',
        'Você tem 1 mês grátis para organizar seus gastos, cartões e cofrinhos, e conversar com o Crab AI sobre as suas contas.',
      ],
      button: { label: 'Abrir o CRAB FINANCE', url: appUrl('/') },
    }),
  }),
  welcomeConfirm: (name: string, link: string) => ({
    subject: 'Confirme seu e-mail no CRAB FINANCE',
    ...layout({
      eyebrow: 'Bem-vindo ao seu controle financeiro',
      title: `Olá, ${name}! Bem-vindo ao CRAB FINANCE.`,
      preview: 'Falta só confirmar seu e-mail.',
      paragraphs: [
        'Sua conta foi criada e você tem 1 mês grátis para usar tudo.',
        'Falta só confirmar que este e-mail é seu. É por ele que você recupera a senha e recebe os recibos.',
      ],
      button: { label: 'Confirmar meu e-mail', url: link },
      footnote: 'O link vale por 48 horas. Se você não criou esta conta, é só ignorar este e-mail.',
    }),
  }),
  confirm: (name: string, link: string) => ({
    subject: 'Confirme seu e-mail no CRAB FINANCE',
    ...layout({
      eyebrow: 'Confirmação de e-mail',
      title: `Olá, ${name}!`,
      preview: 'Confirme seu e-mail com um clique.',
      paragraphs: ['Clique no botão abaixo para confirmar seu e-mail.'],
      button: { label: 'Confirmar meu e-mail', url: link },
      footnote: 'O link vale por 48 horas. Se não foi você quem pediu, é só ignorar este e-mail.',
    }),
  }),
  reset: (name: string, link: string) => ({
    subject: 'Redefinir sua senha do CRAB FINANCE',
    ...layout({
      eyebrow: 'Redefinir senha',
      title: `Olá, ${name}!`,
      preview: 'Escolha uma nova senha para a sua conta.',
      paragraphs: [
        'Recebemos um pedido para redefinir a senha da sua conta. Clique no botão para escolher uma nova senha.',
      ],
      button: { label: 'Escolher nova senha', url: link },
      footnote:
        'O link vale por 1 hora e só pode ser usado uma vez. Se não foi você quem pediu, ignore este e-mail: sua senha continua a mesma.',
    }),
  }),
  resetGoogle: (name: string) => ({
    subject: 'Sua conta do CRAB FINANCE usa o Google',
    ...layout({
      eyebrow: 'Redefinir senha',
      title: `Olá, ${name}!`,
      preview: 'Sua conta entra pelo Google e não tem senha.',
      paragraphs: [
        'Recebemos um pedido para redefinir a senha, mas a sua conta entra pelo Google e não tem senha.',
        'Para entrar, use o botão "Continuar com Google" na tela de login.',
      ],
      button: { label: 'Ir para o login', url: appUrl('/') },
      footnote: 'Se não foi você quem pediu, é só ignorar este e-mail.',
    }),
  }),
  passwordChanged: (name: string) => ({
    subject: 'Sua senha do CRAB FINANCE foi alterada',
    ...layout({
      eyebrow: 'Aviso de segurança',
      title: `Olá, ${name}! Sua senha foi alterada.`,
      preview: 'A senha da sua conta acabou de ser alterada.',
      paragraphs: [
        'A senha da sua conta acabou de ser alterada e as outras sessões abertas foram encerradas.',
        'Se foi você, está tudo certo. Se não foi, use "Esqueci minha senha" na tela de login agora mesmo para recuperar o acesso.',
      ],
      button: { label: 'Ir para o login', url: appUrl('/') },
    }),
  }),
};

@Injectable()
export class Mailer {
  private transport: Transporter | null = null;

  /** Sends one e-mail. Never throws: a mail problem must not break sign-up or login; it is logged instead. */
  async send(email: Email): Promise<boolean> {
    if (!mailEnabled()) {
      // Development: show the message (and its link) in the terminal. Production never logs links, they are credentials.
      if (process.env.NODE_ENV === 'production') console.warn(`E-mail não enviado (SMTP_URL vazio): ${email.subject}`);
      else console.warn(`\n[e-mail para ${email.to}] ${email.subject}\n${email.text}\n`);
      return false;
    }
    try {
      // Short timeouts: a slow mail server must not keep a sign-up waiting.
      this.transport ??= createTransport({
        url: process.env.SMTP_URL,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
      });
      await this.transport.sendMail({
        from: process.env.EMAIL_FROM || 'CRAB FINANCE <nao-responda@localhost>',
        to: email.to,
        subject: email.subject,
        text: email.text,
        html: email.html,
        attachments: inlineImages(),
      });
      return true;
    } catch (err) {
      console.error('Falha ao enviar e-mail:', email.subject, err instanceof Error ? err.message : err);
      return false;
    }
  }
}
