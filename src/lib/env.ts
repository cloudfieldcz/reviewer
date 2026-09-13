/**
 * Reads an environment variable. Astro loads `.env` into `import.meta.env`, not into `process.env`,
 * while Docker / shell variables only land in `process.env` – so both have to be consulted.
 */
export const env = (key: string): string =>
  process.env[key] ?? ((import.meta.env as Record<string, string | undefined> | undefined)?.[key] ?? '');

export const envFlag = (key: string): boolean => env(key).trim().toLowerCase() === 'true';
