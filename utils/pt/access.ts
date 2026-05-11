export const PEDRO_ADMIN_EMAILS = ['pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au'];

export function isPedroAdminEmail(email: string | null | undefined) {
  if (!email) return false;
  return PEDRO_ADMIN_EMAILS.includes(email.toLowerCase());
}
