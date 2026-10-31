import { hashPassword, verifyPassword } from '../../server/src/auth';
describe('Senhas', () => {
  it('usa salt individual e verifica scrypt', async () => {
    const a = await hashPassword('senha-bem-forte'), b = await hashPassword('senha-bem-forte');
    expect(a).not.toBe(b); expect(await verifyPassword('senha-bem-forte', a)).toBe(true); expect(await verifyPassword('outra-senha', a)).toBe(false);
  });
  it.each(['', '!inutilizavel', 'scrypt$x$00', 'formato-desconhecido$salt$key'])('rejeita hash inválido', async value => expect(await verifyPassword('senha', value)).toBe(false));
});
