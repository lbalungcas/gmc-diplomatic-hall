import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { FormSection } from '../components/FormSection';
import { PublicShell } from '../components/PublicShell';
import { Turnstile, turnstileEnabled } from '../components/Turnstile';
import { EVENT_SLUG } from '../lib/constants';
import {
  extractCore, isEmail, nextSectionId, questionFor, resolveForm, SUBMIT, validateSection,
  type Answer, type Answers, type FormQuestion, type FormSchema,
} from '../lib/form';
import { ApiError, callFunction, supabase } from '../lib/supabase';
import type { EventRow } from '../lib/types';

interface SystemState {
  guardian_name: string;
  guardian_email: string;
  guardian_consent: boolean;
  privacy_consent: boolean;
  photo_consent: boolean;
}

const EMPTY_SYSTEM: SystemState = { guardian_name: '', guardian_email: '', guardian_consent: false, privacy_consent: false, photo_consent: false };
const DRAFT_KEY = `yim-registration-draft:${EVENT_SLUG}`;

// The draft survives an accidental reload. sessionStorage can throw (private mode), so guard it.
function loadDraft(): { answers: Answers; history: string[]; system: SystemState } | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function Register(props: { previewSchema?: FormSchema }) {
  const preview = !!props.previewSchema;
  const navigate = useNavigate();
  const [event, setEvent] = useState<EventRow | null>(null);
  const [availability, setAvailability] = useState<{ registration_open: boolean; is_full: boolean; auto_waitlist: boolean } | null>(null);
  const [loaded, setLoaded] = useState(preview);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const draft = useMemo(() => (preview ? null : loadDraft()), [preview]);
  const [answers, setAnswers] = useState<Answers>(draft?.answers ?? {});
  const [system, setSystem] = useState<SystemState>(draft?.system ?? EMPTY_SYSTEM);
  const [history, setHistory] = useState<string[]>(draft?.history ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [duplicateEmail, setDuplicateEmail] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileReset, setTurnstileReset] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (preview) return;
    setLoadError(false);
    Promise.all([
      supabase.from('events').select('*').eq('slug', EVENT_SLUG).maybeSingle(),
      supabase.rpc('event_availability', { p_slug: EVENT_SLUG }),
    ])
      .then(([e, a]) => {
        if (e.error || !e.data) throw e.error ?? new Error('event not found');
        setEvent(e.data as EventRow);
        setAvailability(a.data);
        setLoaded(true);
      })
      .catch(() => setLoadError(true));
  }, [preview, attempt]);

  const schema = useMemo(() => props.previewSchema ?? resolveForm(event?.form_schema), [props.previewSchema, event]);

  // Current section: last entry of the history stack (the first section if none / stale).
  const current = schema.sections.find((s) => s.id === history[history.length - 1]) ?? schema.sections[0];
  const sectionNumber = schema.sections.indexOf(current) + 1;
  const next = nextSectionId(schema, current, answers);
  const isLast = next === SUBMIT;

  useEffect(() => {
    if (preview) return;
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ answers, history, system }));
    } catch {
      /* storage unavailable — the form still works */
    }
  }, [answers, history, system, preview]);

  const ageQuestion = questionFor(schema, 'age');
  const core = extractCore(schema, answers);
  const isMinor = core.age !== null && core.age < 18;

  const onAnswer = useCallback((id: string, value: Answer) => {
    setAnswers((a) => ({ ...a, [id]: value }));
    setErrors((e) => (e[id] ? { ...e, [id]: '' } : e));
    setFormError(null);
  }, []);

  const setSys = <K extends keyof SystemState>(k: K, v: SystemState[K]) => {
    setSystem((s) => ({ ...s, [k]: v }));
    setErrors((e) => (e[k] ? { ...e, [k]: '' } : e));
    setFormError(null);
  };

  function systemErrors(onSection: boolean, final: boolean): Record<string, string> {
    const e: Record<string, string> = {};
    if (onSection && isMinor) {
      if (!system.guardian_name.trim()) e.guardian_name = "Please enter your parent or guardian's name.";
      if (!isEmail(system.guardian_email.trim())) e.guardian_email = "Please enter your parent or guardian's email.";
      else if (system.guardian_email.trim().toLowerCase() === core.email) e.guardian_email = 'Use a different email from your own.';
      if (!system.guardian_consent) e.guardian_consent = 'A parent or guardian must give consent for participants under 18.';
    }
    if (final && !system.privacy_consent) e.privacy_consent = 'You need to agree to the data privacy notice to register.';
    return e;
  }

  function currentErrors() {
    const hasAge = current.blocks.some((b) => b.id === ageQuestion?.id);
    const e = { ...validateSection(current, answers), ...systemErrors(hasAge, isLast) };
    return Object.fromEntries(Object.entries(e).filter(([, v]) => v));
  }

  function focusFirstError(e: Record<string, string>) {
    requestAnimationFrame(() => {
      const first = formRef.current?.querySelector<HTMLElement>(
        Object.keys(e).map((k) => `[data-question="${k}"] input, [data-question="${k}"] textarea, [name="${k}"]`).join(', '),
      );
      first?.focus();
      first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  function goTo(ids: string[]) {
    setHistory(ids);
    setErrors({});
    setFormError(null);
    window.scrollTo({ top: 0 });
    requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }));
  }

  function onNext() {
    const e = currentErrors();
    setErrors(e);
    if (Object.keys(e).length) {
      setFormError('Please answer the highlighted questions.');
      focusFirstError(e);
      return;
    }
    const stack = history.length ? history : [current.id];
    goTo([...stack, next]);
  }

  function onBack() {
    goTo(history.slice(0, -1));
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    if (!isLast) return onNext();
    const e = currentErrors();
    setErrors(e);
    if (Object.keys(e).length) {
      setFormError('Please answer the highlighted questions.');
      focusFirstError(e);
      return;
    }
    if (preview) {
      setFormError('Preview only — nothing was submitted.');
      return;
    }
    if (turnstileEnabled && !turnstileToken) {
      setFormError('Please complete the "I am human" check below.');
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      const website = (formRef.current?.elements.namedItem('website') as HTMLInputElement | null)?.value ?? '';
      const res = await callFunction<{ status: 'created' | 'duplicate'; token?: string }>('register', {
        answers,
        ...system,
        website,
        turnstileToken,
      });
      try {
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
      if (res.status === 'duplicate') {
        setDuplicateEmail(core.email);
        window.scrollTo({ top: 0 });
      } else if (res.token) {
        navigate(`/t/${res.token}`, { state: { justRegistered: true } });
      } else {
        navigate('/registered');
      }
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : new ApiError('Something went wrong. Please try again.');
      setFormError(apiErr.message);
      if (apiErr.details && typeof apiErr.details === 'object') {
        // A server-side error may belong to an earlier section: jump back to the first one that has it.
        const details = apiErr.details as Record<string, string>;
        setErrors(details);
        const stack = history.length ? history : [current.id];
        const idx = stack.findIndex((sid) => {
          const s = schema.sections.find((x) => x.id === sid);
          return s?.blocks.some((b) => details[b.id] || (b.id === ageQuestion?.id && (details.guardian_name || details.guardian_email || details.guardian_consent)));
        });
        if (idx >= 0 && idx < stack.length - 1) {
          setHistory(stack.slice(0, idx + 1));
        }
        focusFirstError(details);
      }
      setTurnstileReset((n) => n + 1);
    } finally {
      setSubmitting(false);
    }
  }

  const closed = !preview && availability && !availability.registration_open;

  if (loadError) {
    return (
      <PublicShell>
        <div role="alert" className="card space-y-3 p-6 text-center">
          <h1 className="text-xl font-bold">We couldn't load the registration form</h1>
          <p>Please check your internet connection and try again.</p>
          <button className="btn-primary" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
        </div>
      </PublicShell>
    );
  }

  if (!loaded) {
    return <PublicShell><p className="py-20 text-center text-slate-500">Loading the registration form…</p></PublicShell>;
  }

  if (duplicateEmail) {
    return (
      <PublicShell>
        <div role="status" className="card space-y-2 p-6">
          <h1 className="text-2xl font-bold">You're already registered</h1>
          <p>
            We've re-sent the latest email about your registration to <strong>{duplicateEmail}</strong>. Please check your inbox
            (and spam folder).
          </p>
        </div>
      </PublicShell>
    );
  }

  const content = closed ? (
    <div className="card p-6">
      <h1 className="text-xl font-bold">Registration is closed</h1>
      <p className="mt-2">
        Thank you for your interest. Online pre-registration for this event is closed.
        {event && <> For questions, write to <a className="font-semibold text-navy underline" href={`mailto:${event.contact_email}`}>{event.contact_email}</a>.</>}
      </p>
    </div>
  ) : (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-5">
      {availability?.is_full && availability.auto_waitlist && (
        <p className="rounded-xl border border-sky-300 bg-sky-50 p-4 text-sm text-sky-950">
          The event is currently at capacity. You can still register — you'll be placed on the <strong>waitlist</strong> and
          we'll email you if a place opens up.
        </p>
      )}

      <FormSection
        key={current.id}
        section={current}
        number={sectionNumber}
        total={schema.sections.length}
        answers={answers}
        errors={errors}
        onChange={onAnswer}
        headingRef={headingRef}
        after={(q: FormQuestion) =>
          q.id === ageQuestion?.id && isMinor ? <GuardianStep system={system} errors={errors} set={setSys} /> : null
        }
      />

      {isLast && <ConsentStep system={system} errors={errors} set={setSys} isMinor={isMinor} contact={event?.contact_email} />}

      {/* Honeypot: hidden from people and screen readers; bots fill it in. */}
      <div className="absolute -left-[9999px]" aria-hidden="true">
        <label>Website <input tabIndex={-1} autoComplete="off" name="website" defaultValue="" /></label>
      </div>

      {isLast && !preview && <Turnstile onToken={setTurnstileToken} resetKey={turnstileReset} />}

      {formError && (
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-900">{formError}</p>
      )}

      <div className="flex items-center justify-between gap-3 pb-4">
        <div className="flex gap-2">
          {history.length > 1 && (
            <button type="button" className="btn-ghost px-6" onClick={onBack}>Back</button>
          )}
          {isLast ? (
            <button type="submit" className="btn-primary px-8 py-3 text-base" disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
          ) : (
            <button type="button" className="btn-primary px-8 py-3 text-base" onClick={onNext}>Next</button>
          )}
        </div>
        <Progress value={sectionNumber} total={schema.sections.length} />
      </div>
    </form>
  );

  return preview ? content : <PublicShell>{content}</PublicShell>;
}

function Progress({ value, total }: { value: number; total: number }) {
  return (
    <div className="flex shrink-0 items-center gap-2 text-xs whitespace-nowrap text-slate-500" aria-label={`Page ${value} of ${total}`}>
      <div className="h-2 w-14 overflow-hidden rounded-full bg-slate-200 sm:w-40" aria-hidden="true">
        <div className="h-full rounded-full bg-navy" style={{ width: `${(value / total) * 100}%` }} />
      </div>
      Page {value} of {total}
    </div>
  );
}

type SetSys = <K extends keyof SystemState>(k: K, v: SystemState[K]) => void;

/** Shown right after the Age question for under-18s (child safeguarding). */
function GuardianStep({ system, errors, set }: { system: SystemState; errors: Record<string, string>; set: SetSys }) {
  return (
    <div className="card space-y-5 border-sun-dark bg-sun-light/60 p-5 sm:p-6">
      <div>
        <h3 className="text-lg text-slate-900">Parent / Guardian Consent</h3>
        <p className="mt-1 text-sm text-slate-700">
          Because you are under 18, we need your parent or guardian's details and consent before you can attend. They are only
          used for safeguarding — for example, if we need to reach them on the day.
        </p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <SysInput label="Parent / guardian full name" name="guardian_name" value={system.guardian_name} error={errors.guardian_name} onChange={(v) => set('guardian_name', v)} />
        <SysInput label="Parent / guardian email" name="guardian_email" type="email" value={system.guardian_email} error={errors.guardian_email} onChange={(v) => set('guardian_email', v)} />
      </div>
      <SysCheckbox name="guardian_consent" checked={system.guardian_consent} error={errors.guardian_consent} required onChange={(v) => set('guardian_consent', v)}>
        My parent or guardian knows about this registration and consents to my participation in the Youth Innovations
        Marketplace and to the processing of my personal data as described in the data privacy notice.
      </SysCheckbox>
    </div>
  );
}

/** Data privacy (RA 10173) and photo consent, shown on the final page above Submit. */
function ConsentStep({ system, errors, set, isMinor, contact }: { system: SystemState; errors: Record<string, string>; set: SetSys; isMinor: boolean; contact?: string }) {
  return (
    <div className="card space-y-5 p-5 sm:p-6">
      <h3 className="text-lg text-slate-900">Data Privacy &amp; Photo Consent</h3>
      <details className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm open:bg-white">
        <summary className="cursor-pointer font-semibold text-navy">Read the data privacy notice</summary>
        <PrivacyNotice contact={contact ?? 'violenceendswithus@gmail.com'} />
      </details>
      <SysCheckbox name="privacy_consent" checked={system.privacy_consent} error={errors.privacy_consent} required onChange={(v) => set('privacy_consent', v)}>
        I have read the data privacy notice and agree to the collection and processing of my personal data for this event,
        in line with the Philippine Data Privacy Act of 2012 (RA 10173).
      </SysCheckbox>
      <SysCheckbox name="photo_consent" checked={system.photo_consent} onChange={(v) => set('photo_consent', v)}>
        <strong>Optional:</strong> I agree to be photographed or filmed at the event, and for the organisers to use these images
        to communicate about the event. {isMinor && 'My parent or guardian also agrees. '}You can still attend if you leave this
        unticked — the media team will respect your choice.
      </SysCheckbox>
    </div>
  );
}

function SysInput({ label, name, value, error, onChange, type = 'text' }: { label: string; name: string; value: string; error?: string; onChange: (v: string) => void; type?: string }) {
  const id = useId();
  return (
    <div data-question={name}>
      <label htmlFor={id} className="label">{label} <span className="text-tdh-red" aria-hidden="true">*</span></label>
      <input id={id} name={name} type={type} className="input" value={value} required aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-e` : undefined} onChange={(e) => onChange(e.target.value)} />
      {error && <p id={`${id}-e`} className="mt-1 text-sm font-medium text-red-700">{error}</p>}
    </div>
  );
}

function SysCheckbox({ name, checked, onChange, error, required, children }: {
  name: string; checked: boolean; onChange: (v: boolean) => void; error?: string; required?: boolean; children: ReactNode;
}) {
  const id = useId();
  return (
    <div data-question={name}>
      <label htmlFor={id} className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-slate-800">
        <input id={id} name={name} type="checkbox" className="mt-0.5 size-5 shrink-0 accent-navy" checked={checked} required={required}
          aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-e` : undefined} onChange={(e) => onChange(e.target.checked)} />
        <span>{children} {required && <span className="text-tdh-red" aria-hidden="true">*</span>}</span>
      </label>
      {error && <p id={`${id}-e`} className="mt-1 text-sm font-medium text-red-700">{error}</p>}
    </div>
  );
}

function PrivacyNotice({ contact }: { contact: string }) {
  return (
    <div className="mt-3 space-y-3 leading-relaxed text-slate-700">
      <p>
        <strong>Who we are.</strong> The Youth Innovations Marketplace is convened by Violence Ends With Us (Global Youth-Led
        Movement on Ending Violence Against Children) and co-hosted by Terre des Hommes Netherlands and Kindernothilfe
        ("the organisers").
      </p>
      <p>
        <strong>What we collect.</strong> Your answers to this form — including your name, preferred name, age, nationality,
        country of residence, sex assigned at birth, gender identity, email, mobile number, organisation, participation
        category and interests — your consent choices, and, for participants under 18, a parent or guardian's name, email and
        consent. On the day we record the time you check in.
      </p>
      <p>
        <strong>Why.</strong> To review and confirm your registration, send you your ticket, calendar invites and event updates,
        arrange Deal Corner match-making if you asked for it, manage venue capacity and security, and protect children
        attending the event. Age, sex and gender information is reported to partners only as anonymous totals.
      </p>
      <p>
        <strong>Who sees it.</strong> Only the organisers' registration team. Door staff see your name, organisation, category
        and photo-consent choice when scanning your ticket — never your contact details. Data is stored with our service
        providers (Supabase for the database, Resend for email) and is never sold or used for marketing.
      </p>
      <p>
        <strong>How long.</strong> We delete or anonymise your personal data <strong>90 days after the event</strong>, keeping
        only anonymous statistics.
      </p>
      <p>
        <strong>Your rights.</strong> Under RA 10173 you may access, correct or ask us to delete your data, or withdraw consent,
        at any time by writing to <strong>{contact}</strong>.
      </p>
    </div>
  );
}
