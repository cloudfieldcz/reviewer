import { env } from '../env';
import { resolveLocale, type Locale } from './index';

/**
 * Locale of a review-screen request – also of the pages served inside its frame, whose requests carry
 * the same browser `Accept-Language`. Falls back to `DEFAULT_LOCALE` (`en` when unset or unsupported).
 */
export const requestLocale = (request: Request): Locale => resolveLocale(request.headers.get('accept-language'), env('DEFAULT_LOCALE'));
