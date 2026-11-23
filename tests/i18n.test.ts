import { afterEach, describe, expect, it } from 'vitest';
import { API_ERRORS, DICTIONARIES, errorText, resolveLocale, translator, type ApiFailure } from '~/lib/i18n';
import { cs } from '~/lib/i18n/cs';
import { en } from '~/lib/i18n/en';
import { requestLocale } from '~/lib/i18n/server';
import { errorPage } from '~/lib/proxy/handler';
import { emptyPage } from '~/lib/sites';

describe('resolveLocale', () => {
  it('takes the Accept-Language header over the default', () => {
    expect(resolveLocale('cs-CZ,cs;q=0.9,en;q=0.8', 'en')).toBe('cs');
    expect(resolveLocale('en-GB,en;q=0.9', 'cs')).toBe('en');
  });

  it('picks the first supported language, by quality and then by order', () => {
    expect(resolveLocale('de-DE,de;q=0.9,cs;q=0.8,en;q=0.7', 'en')).toBe('cs');
    expect(resolveLocale('en;q=0.5,cs;q=0.9', 'en')).toBe('cs');
    expect(resolveLocale('fr, en, cs', 'cs')).toBe('en');
    expect(resolveLocale('cs;q=0, en;q=0.1', 'cs')).toBe('en');
  });

  it('maps Slovak to Czech', () => {
    expect(resolveLocale('sk', 'en')).toBe('cs');
    expect(resolveLocale('sk-SK,sk;q=0.9,en;q=0.5', 'en')).toBe('cs');
  });

  it('falls back to the default when the header has no supported language, then to en', () => {
    expect(resolveLocale('de-DE,fr;q=0.8,*;q=0.5', 'cs')).toBe('cs');
    expect(resolveLocale(null, 'cs')).toBe('cs');
    expect(resolveLocale('', 'cs-CZ')).toBe('cs');
    expect(resolveLocale('de', '')).toBe('en');
    expect(resolveLocale('de', 'pl')).toBe('en');
    expect(resolveLocale(undefined, undefined)).toBe('en');
  });

  describe('requestLocale (DEFAULT_LOCALE through env())', () => {
    const before = process.env.DEFAULT_LOCALE;
    afterEach(() => {
      if (before === undefined) delete process.env.DEFAULT_LOCALE;
      else process.env.DEFAULT_LOCALE = before;
    });
    const req = (lang?: string) => new Request('http://reviewer.test/review/1', { headers: lang ? { 'accept-language': lang } : {} });

    it('uses the header first and DEFAULT_LOCALE only without a supported language', () => {
      process.env.DEFAULT_LOCALE = 'cs';
      expect(requestLocale(req('en-US'))).toBe('en');
      expect(requestLocale(req('de'))).toBe('cs');
      expect(requestLocale(req())).toBe('cs');
      delete process.env.DEFAULT_LOCALE;
      expect(requestLocale(req('de'))).toBe('en');
    });
  });
});

describe('translator', () => {
  it('uses Czech plurals: 1 komentář, 2–4 komentáře, 0 and 5+ komentářů', () => {
    const t = translator('cs');
    const other = (n: number) => t('sidebar.otherPhone', { count: n });
    expect(other(1)).toBe('1 komentář v zobrazení iPhone 15 – přepnout');
    expect(other(2)).toBe('2 komentáře v zobrazení iPhone 15 – přepnout');
    expect(other(4)).toBe('4 komentáře v zobrazení iPhone 15 – přepnout');
    expect(other(5)).toBe('5 komentářů v zobrazení iPhone 15 – přepnout');
    expect(other(0)).toBe('0 komentářů v zobrazení iPhone 15 – přepnout');
    expect(other(22)).toBe('22 komentářů v zobrazení iPhone 15 – přepnout');
    expect(t('sidebar.hiddenByStatus', { count: 3 })).toBe('Filtr stavu skrývá 3 komentáře.');
  });

  it('uses English one / other', () => {
    const t = translator('en');
    expect(t('sidebar.hiddenByStatus', { count: 1 })).toBe('1 comment is hidden by the status filter.');
    expect(t('sidebar.hiddenByStatus', { count: 2 })).toBe('2 comments are hidden by the status filter.');
    expect(t('sidebar.otherDesktop', { count: 0 })).toBe('0 comments in the desktop view – switch');
  });

  it('fills {name} parameters and leaves unknown ones visible', () => {
    expect(translator('en')('page.title', { name: 'Shop' })).toBe('Review · Shop');
    expect(translator('cs')('card.decidedBy', { status: 'Schválený', who: 'vy' })).toBe('Schválený · vy');
    expect(translator('cs')('quote', { text: 'Odeslat' })).toBe('„Odeslat“');
    expect(translator('en')('page.title')).toBe('Review · {name}');
  });
});

describe('dictionaries', () => {
  it('cs has no key en lacks (the type check covers the opposite)', () => {
    const extra = Object.keys(cs).filter((k) => !(k in en));
    expect(extra).toEqual([]);
    expect(Object.keys(DICTIONARIES).sort()).toEqual(['cs', 'en']);
  });

  it('every plural has the forms its language needs', () => {
    for (const [key, value] of Object.entries(en)) {
      if (typeof value === 'string') continue;
      expect(Object.keys(value).sort(), `en ${key}`).toEqual(['one', 'other']);
      const czech = cs[key as keyof typeof cs];
      expect(typeof czech, `cs ${key}`).toBe('object');
      expect(czech, `cs ${key}`).toMatchObject({ one: expect.any(String), few: expect.any(String), other: expect.any(String) });
    }
  });

  it('every mapped API message is the server text, unchanged in English', () => {
    for (const [message, key] of Object.entries(API_ERRORS)) expect(en[key], key).toBe(message);
  });
});

describe('errorText', () => {
  const fail = (message: string, status: number | null, fromServer: boolean): ApiFailure & Error =>
    Object.assign(new Error(message), { status, fromServer });
  const t = translator('cs');

  it('maps a known API message, a missing answer and a bare status', () => {
    expect(errorText(t, fail('Comment must not be empty', 400, true))).toBe('Komentář nesmí být prázdný');
    expect(errorText(t, fail('Failed to fetch', null, false))).toBe('Reviewer je nedostupný – zkontrolujte připojení a zkuste to znovu.');
    expect(errorText(t, fail('HTTP 502', 502, false))).toBe('Požadavek se nepovedl (HTTP 502).');
  });

  it('shows an unknown message as detail – in English exactly as before', () => {
    expect(errorText(t, fail('page_path is required', 400, true))).toBe('Něco se nepovedlo: page_path is required');
    expect(errorText(translator('en'), fail('page_path is required', 400, true))).toBe('page_path is required');
    expect(errorText(translator('en'), new Error('boom'))).toBe('boom');
  });
});

describe('pages inside the review frame', () => {
  it('"nothing uploaded" speaks the frame request’s language', async () => {
    const czech = await emptyPage('cs').text();
    expect(czech).toContain('<html lang="cs">');
    expect(czech).toContain('Zatím nebylo nic nahráno');
    expect(await emptyPage().text()).toContain('Nothing has been uploaded yet');
  });

  it('the proxy error page is recognisable by its meta in every language', async () => {
    for (const locale of ['cs', 'en'] as const) {
      const res = errorPage(502, 'x', 'https://site.example.com/', locale);
      expect(res.status).toBe(502);
      const html = await res.text();
      expect(html).toContain(`<html lang="${locale}">`);
      expect(html).toContain('<meta name="reviewer-error" content="proxy">');
    }
    expect(await errorPage(502, 'x', 'https://t.example/', 'cs').text()).toContain('Stránku se nepodařilo načíst');
  });
});
