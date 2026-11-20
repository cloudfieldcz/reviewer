/**
 * Review-screen i18n: two dictionaries, a `t(key, params)` with `{name}` interpolation and plurals via
 * `Intl.PluralRules`. No library, no cookie, no switch – the locale comes from the request (see
 * `server.ts`). Imported by the island too, so nothing here may touch `process.env`.
 */
import { cs } from './cs';
import { en, type Plural } from './en';

export type { Plural };
export const LOCALES = ['cs', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export type MessageKey = keyof typeof en;
/** The shape every dictionary has: the keys of `en`, a plural wherever `en` has one. */
export type Messages = { [K in MessageKey]: (typeof en)[K] extends string ? string : Plural };

export const DICTIONARIES: Record<Locale, Messages> = { cs, en };
/** What `Intl` date and time formatting uses for each locale. */
export const DATE_LOCALE: Record<Locale, string> = { cs: 'cs-CZ', en: 'en-GB' };

/** `cs`, `cs-CZ`, `sk`, `sk-SK` → `cs` (Slovak readers get Czech); `en-*` → `en`; anything else → null. */
export function matchLocale(tag: string | null | undefined): Locale | null {
  const lang = (tag ?? '').trim().toLowerCase().split(/[-_]/)[0];
  if (lang === 'cs' || lang === 'sk') return 'cs';
  if (lang === 'en') return 'en';
  return null;
}

/**
 * The review screen's locale: the first supported language of `Accept-Language` (by quality, then
 * order), else `fallback` (the `DEFAULT_LOCALE` setting) when it names a supported one, else `en`.
 */
export function resolveLocale(acceptLanguage: string | null | undefined, fallback?: string | null): Locale {
  const ranges = (acceptLanguage ?? '')
    .split(',')
    .map((part, i) => {
      const [tag = '', ...params] = part.split(';').map((s) => s.trim());
      const q = params.find((p) => /^q=/i.test(p));
      const quality = q ? Number(q.slice(2)) : 1;
      return { tag, quality: Number.isFinite(quality) ? quality : 0, i };
    })
    .filter((r) => r.tag && r.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.i - b.i);
  for (const r of ranges) {
    const hit = matchLocale(r.tag);
    if (hit) return hit;
  }
  return matchLocale(fallback) ?? 'en';
}

export type Params = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: Params) => string;

/** `t` for one locale. A plural entry is chosen by `params.count`; `{name}` without a parameter stays as is. */
export function translator(locale: Locale): Translate {
  const dict = DICTIONARIES[locale] ?? en;
  const rules = new Intl.PluralRules(locale);
  return (key, params = {}) => {
    const msg = dict[key] ?? en[key];
    const text = typeof msg === 'string' ? msg : (msg[rules.select(Number(params.count ?? 0))] ?? msg.other);
    return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
  };
}

/**
 * The API answers in English. The messages the review screen can run into are mapped to keys here, so
 * the error bar speaks the reader's language without the API knowing about locales. Anything else is
 * shown through `error.unexpected` with the server's text as detail.
 */
export const API_ERRORS: Record<string, MessageKey> = {
  'Comment must not be empty': 'api.commentEmpty',
  'Reply must not be empty': 'api.replyEmpty',
  'You can only edit your own comments': 'api.editOwn',
  'You can only delete your own comments': 'api.deleteOwn',
  'A decided comment can no longer be edited': 'api.decidedEdit',
  'A decided comment can no longer be deleted': 'api.decidedDelete',
  'You can only modify your own replies': 'api.replyOwn',
  'Only a project manager can do this': 'api.managerOnly',
  'Comment not found': 'api.commentNotFound',
  'Reply not found': 'api.replyNotFound',
  'Project not found': 'api.projectNotFound',
  'Internal error': 'api.internal',
};

/** What `lib/client/api.ts` throws: `status` null = no answer at all; `fromServer` = `message` is the API's own text. */
export interface ApiFailure {
  message: string;
  status: number | null;
  fromServer: boolean;
}

/**
 * Error-bar text for anything an API call threw: a known API message, no answer (network), a bare
 * HTTP status without a message, or else the raw text as detail.
 */
export function errorText(t: Translate, e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  const f = e as Partial<ApiFailure> | null;
  if (f && typeof f === 'object' && 'status' in f) {
    if (f.status == null) return t('error.network');
    if (!f.fromServer) return t('error.http', { status: f.status });
    const known = API_ERRORS[message];
    if (known) return t(known);
  }
  return t('error.unexpected', { detail: message });
}
