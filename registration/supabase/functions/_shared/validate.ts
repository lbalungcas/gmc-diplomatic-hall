import { isEmail } from './form.ts';

/**
 * Fields that are part of every registration regardless of how the form is edited: data-privacy
 * consent (RA 10173), optional photo consent, and parent/guardian consent for under-18s.
 */
export interface SystemFields {
  guardian_name: string | null;
  guardian_email: string | null;
  guardian_consent: boolean;
  photo_consent: boolean;
  privacy_consent: boolean;
}

function str(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const s = value.replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

const bool = (value: unknown) => value === true || value === 'true';

export function validateSystemFields(raw: Record<string, unknown>, age: number | null, email: string, strict: boolean) {
  const errors: Record<string, string> = {};
  const v: SystemFields = {
    guardian_name: str(raw.guardian_name, 200),
    guardian_email: str(raw.guardian_email, 254)?.toLowerCase() ?? null,
    guardian_consent: bool(raw.guardian_consent),
    photo_consent: bool(raw.photo_consent),
    privacy_consent: bool(raw.privacy_consent),
  };

  if (strict && !v.privacy_consent) errors.privacy_consent = 'You need to agree to the privacy notice to register.';

  if (age !== null && age < 18) {
    if (!v.guardian_name) errors.guardian_name = "Please enter your parent or guardian's name.";
    if (!isEmail(v.guardian_email)) errors.guardian_email = "Please enter your parent or guardian's email.";
    else if (v.guardian_email === email) errors.guardian_email = 'Use a different email from your own.';
    if (!v.guardian_consent) errors.guardian_consent = 'A parent or guardian must give consent for participants under 18.';
  } else {
    v.guardian_name = null;
    v.guardian_email = null;
    v.guardian_consent = false;
  }

  return { value: v, errors };
}
