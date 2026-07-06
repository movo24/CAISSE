import {
  resolveAdminCliConfig,
  generateTempPassword,
  parseMode,
  AdminCliError,
  CONFIRM_TOKEN,
  MIN_IMPOSED_PASSWORD_LENGTH,
} from './admin-cli.core';

/** Minimal valid env for a create/reset run. */
const baseEnv = (over: Record<string, string | undefined> = {}) => ({
  ADMIN_CLI_CONFIRM: CONFIRM_TOKEN,
  ADMIN_EMAIL: 'admin@example.com',
  ...over,
});

describe('generateTempPassword', () => {
  it('returns a string of the requested length (clamped to [8,64])', () => {
    expect(generateTempPassword(12)).toHaveLength(12);
    expect(generateTempPassword(4)).toHaveLength(8); // clamped up
    expect(generateTempPassword(999)).toHaveLength(64); // clamped down
  });

  it('never contains ambiguous characters (0 O 1 l I)', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateTempPassword(20)).not.toMatch(/[0O1lI]/);
    }
  });

  it('is alphanumeric', () => {
    expect(generateTempPassword(32)).toMatch(/^[A-Za-z0-9]+$/);
  });

  it('is effectively unique across calls', () => {
    const set = new Set(Array.from({ length: 200 }, () => generateTempPassword(16)));
    expect(set.size).toBe(200);
  });
});

describe('parseMode', () => {
  it('extracts create/reset from argv', () => {
    expect(parseMode(['node', 'admin-cli.ts', 'create'])).toBe('create');
    expect(parseMode(['node', 'admin-cli.ts', 'reset'])).toBe('reset');
  });
  it('throws on a missing/invalid mode', () => {
    expect(() => parseMode(['node', 'admin-cli.ts'])).toThrow(AdminCliError);
    expect(() => parseMode(['node', 'admin-cli.ts', 'delete'])).toThrow(AdminCliError);
  });
});

describe('resolveAdminCliConfig — safety gates', () => {
  it('refuses without the confirmation token', () => {
    expect(() => resolveAdminCliConfig({ ADMIN_EMAIL: 'a@b.co' }, 'create')).toThrow(/ADMIN_CLI_CONFIRM/);
    expect(() => resolveAdminCliConfig(baseEnv({ ADMIN_CLI_CONFIRM: 'nope' }), 'create')).toThrow(/ADMIN_CLI_CONFIRM/);
  });

  it('refuses in production without the explicit prod opt-in', () => {
    expect(() => resolveAdminCliConfig(baseEnv({ NODE_ENV: 'production' }), 'create'))
      .toThrow(/production/i);
  });

  it('allows production only with ADMIN_CLI_ALLOW_PROD=YES', () => {
    const cfg = resolveAdminCliConfig(baseEnv({ NODE_ENV: 'production', ADMIN_CLI_ALLOW_PROD: 'YES' }), 'reset');
    expect(cfg.isProduction).toBe(true);
    expect(cfg.mode).toBe('reset');
  });

  it('requires a valid email', () => {
    expect(() => resolveAdminCliConfig(baseEnv({ ADMIN_EMAIL: '' }), 'create')).toThrow(/ADMIN_EMAIL est requis/);
    expect(() => resolveAdminCliConfig(baseEnv({ ADMIN_EMAIL: 'not-an-email' }), 'create')).toThrow(/invalide/);
  });

  it('lowercases + trims the email', () => {
    expect(resolveAdminCliConfig(baseEnv({ ADMIN_EMAIL: '  Admin@Example.COM ' }), 'create').email)
      .toBe('admin@example.com');
  });
});

describe('resolveAdminCliConfig — password handling', () => {
  it('generates a temporary password when none is imposed', () => {
    const cfg = resolveAdminCliConfig(baseEnv(), 'create');
    expect(cfg.generated).toBe(true);
    expect(cfg.password.length).toBeGreaterThanOrEqual(8);
  });

  it('accepts an imposed password of sufficient length', () => {
    const cfg = resolveAdminCliConfig(baseEnv({ ADMIN_PASSWORD: 'Sup3rTemp' }), 'create');
    expect(cfg.generated).toBe(false);
    expect(cfg.password).toBe('Sup3rTemp');
  });

  it('rejects an imposed password that is too short', () => {
    expect(() => resolveAdminCliConfig(baseEnv({ ADMIN_PASSWORD: 'x'.repeat(MIN_IMPOSED_PASSWORD_LENGTH - 1) }), 'create'))
      .toThrow(/trop court/);
  });

  it('carries store + name fields with sane defaults', () => {
    const cfg = resolveAdminCliConfig(baseEnv({ ADMIN_STORE_CODE: 'paris01' }), 'create');
    expect(cfg.storeCode).toBe('paris01');
    expect(cfg.firstName).toBe('Admin');
    expect(cfg.lastName).toBe('Caisse');
  });
});
