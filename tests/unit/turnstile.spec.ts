import { turnstileSiteKey, verifyTurnstile } from '../../server/src/turnstile';
describe('Turnstile', () => {
  const env = { ...process.env };
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
    process.env.TURNSTILE_SITE_KEY = 'site';
    process.env.TURNSTILE_SECRET_KEY = 'secret';
  });
  afterAll(() => {
    process.env = env;
  });
  it('fica desligado sem as duas chaves', async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    expect(turnstileSiteKey()).toBeNull();
    await expect(verifyTurnstile(undefined)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('exige o token antes de consultar a Cloudflare', async () => {
    await expect(verifyTurnstile(undefined)).rejects.toThrow('Confirme a verificação de segurança.');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('aceita token validado e envia o segredo', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ success: true }) });
    await expect(verifyTurnstile('tok')).resolves.toBeUndefined();
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get('secret')).toBe('secret');
    expect(body.get('response')).toBe('tok');
  });
  it('rejeita token recusado', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }) });
    await expect(verifyTurnstile('tok')).rejects.toThrow('Verificação de segurança falhou');
  });
  it('responde 503 quando a Cloudflare não responde', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(verifyTurnstile('tok')).rejects.toMatchObject({ status: 503 });
  });
});
