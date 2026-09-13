import type { APIRoute } from 'astro';
import { json } from '~/lib/http';

export const GET: APIRoute = ({ locals }) => {
  const { email, name, role } = locals.user;
  return json({ email, name, role });
};
