import { afterEach, describe, expect, it } from 'vitest';
import { resolveRole } from '~/lib/auth';
import { normalizeBaseUrl, isPrivateAddress } from '~/lib/url';

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe('resolveRole', () => {
  it('maps Entra app roles from X-Forwarded-Groups', () => {
    process.env.DEFAULT_ROLE = '';
    expect(resolveRole('ADMIN', 'a@b.cz')).toBe('admin');
    expect(resolveRole('USER', 'a@b.cz')).toBe('user');
    expect(resolveRole('admin,user', 'a@b.cz')).toBe('admin');
    expect(resolveRole('USER, ADMIN', 'a@b.cz')).toBe('admin');
    expect(resolveRole('Something', 'a@b.cz')).toBeNull();
    expect(resolveRole(null, 'a@b.cz')).toBeNull();
  });
  it('bootstrap admins via ADMIN_EMAILS', () => {
    process.env.DEFAULT_ROLE = '';
    process.env.ADMIN_EMAILS = 'Boss@Firma.cz, other@firma.cz';
    expect(resolveRole(null, 'boss@firma.cz')).toBe('admin');
    expect(resolveRole('USER', 'other@firma.cz')).toBe('admin');
    expect(resolveRole('USER', 'x@firma.cz')).toBe('user');
  });
  it('DEFAULT_ROLE fills in when no role claim is present', () => {
    process.env.ADMIN_EMAILS = '';
    process.env.DEFAULT_ROLE = 'user';
    expect(resolveRole(null, 'x@firma.cz')).toBe('user');
    expect(resolveRole('', 'x@firma.cz')).toBe('user');
    expect(resolveRole('ADMIN', 'x@firma.cz')).toBe('admin');
  });
});

describe('normalizeBaseUrl', () => {
  it('normalizes and rejects bad input', () => {
    expect(normalizeBaseUrl(' https://Test.Example.com/ ')).toBe('https://test.example.com');
    expect(normalizeBaseUrl('https://host/sub/')).toBe('https://host/sub');
    expect(() => normalizeBaseUrl('ftp://x')).toThrow();
    expect(() => normalizeBaseUrl('https://x/?a=1')).toThrow();
    expect(() => normalizeBaseUrl('https://user:pw@x/')).toThrow();
    expect(() => normalizeBaseUrl('not a url')).toThrow();
  });
  it('http only when explicitly allowed', () => {
    delete process.env.ALLOW_HTTP_TARGETS;
    expect(() => normalizeBaseUrl('http://x.cz')).toThrow();
    process.env.ALLOW_HTTP_TARGETS = 'true';
    expect(normalizeBaseUrl('http://x.cz')).toBe('http://x.cz');
  });
});

describe('isPrivateAddress', () => {
  it('detects private / loopback / link-local ranges', () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.5.5', '192.168.1.1', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '20.50.60.70', '2606:4700::1111']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});
