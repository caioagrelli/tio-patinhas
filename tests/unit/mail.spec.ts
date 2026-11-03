import { emails } from '../../server/src/mail';

describe('modelos de e-mail', () => {
  it('escapam o nome da pessoa no HTML e mantêm o texto puro legível', () => {
    const email = emails.welcomeConfirm(
      '<img src=x onerror=alert(1)>',
      'https://crab.test/api/auth/verify-email?token=abc',
    );
    expect(email.html).not.toContain('<img src=x');
    expect(email.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(email.text).toContain('Confirmar meu e-mail: https://crab.test/api/auth/verify-email?token=abc');
  });
  it('o link do botão também é escapado', () => {
    expect(emails.reset('Ana', 'https://crab.test/#/redefinir-senha?token=a"b').html).toContain('token=a&quot;b');
  });
});
