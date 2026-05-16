export const PEDRO_ADMIN_EMAILS = ['pedro@cerebroai.au', 'avila.phm@gmail.com'];

export function isPedroAdminEmail(email: string | null | undefined) {
  if (!email) return false;
  return PEDRO_ADMIN_EMAILS.includes(email.toLowerCase());
}
