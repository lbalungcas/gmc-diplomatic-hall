import { useId, type ReactNode } from 'react';
import { OTHER_PREFIX, type Answer, type FormQuestion, type FormSection as Section } from '../lib/form';
import { InlineText, RichText } from './RichText';
import { imageUrl } from '../lib/paths';

interface Props {
  section: Section;
  number: number;
  total: number;
  answers: Record<string, Answer>;
  errors: Record<string, string>;
  onChange: (id: string, value: Answer) => void;
  /** Extra content rendered right after a question (e.g. the guardian step after Age). */
  after?: (q: FormQuestion) => ReactNode;
  headingRef?: React.Ref<HTMLHeadingElement>;
}

/** One page of the registration form, styled like the original Google Form's cards. */
export function FormSection({ section, number, total, answers, errors, onChange, after, headingRef }: Props) {
  return (
    <div className="space-y-4">
      <header className="card overflow-hidden">
        <div className="h-2 bg-navy" aria-hidden="true" />
        <div className="p-5 sm:p-6">
          <p className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">Section {number} of {total}</p>
          {section.title ? (
            <h2 ref={headingRef} tabIndex={-1} className="text-2xl leading-snug font-bold outline-none sm:text-[1.7rem]">
              <InlineText text={section.title} />
            </h2>
          ) : (
            <h2 ref={headingRef} tabIndex={-1} className="sr-only">Section {number}</h2>
          )}
          {section.description && <RichText text={section.description} className="mt-3 text-[0.95rem] text-slate-700" />}
        </div>
      </header>

      {section.blocks.map((b) =>
        b.type === 'text' ? (
          <div key={b.id} className="card p-5 sm:p-6">
            {b.title && <h3 className="mb-2 text-lg text-slate-900"><InlineText text={b.title} /></h3>}
            {b.body && <RichText text={b.body} className="text-[0.95rem] text-slate-700" />}
          </div>
        ) : (
          <div key={b.id} className="space-y-4">
            <Question q={b} value={answers[b.id]} error={errors[b.id]} onChange={(v) => onChange(b.id, v)} />
            {after?.(b)}
          </div>
        ),
      )}
    </div>
  );
}

function Question({ q, value, error, onChange }: { q: FormQuestion; value: Answer | undefined; error?: string; onChange: (v: Answer) => void }) {
  const id = useId();
  const labelId = `${id}-label`;
  const errorId = `${id}-error`;
  const describedBy = [q.help && `${id}-help`, error && errorId].filter(Boolean).join(' ') || undefined;
  const choice = q.kind === 'radio' || q.kind === 'checkbox';

  const label = (
    <>
      <InlineText text={q.label} />
      {q.required && <span className="ml-1 text-tdh-red" aria-hidden="true">*</span>}
    </>
  );

  return (
    <div className={`card p-5 sm:p-6 ${error ? 'border-tdh-red ring-1 ring-tdh-red/40' : ''}`} data-question={q.id}>
      {choice ? (
        <fieldset aria-describedby={describedBy} aria-required={q.required || undefined}>
          <legend id={labelId} className="mb-3 text-base text-slate-900">{label}</legend>
          {q.help && <p id={`${id}-help`} className="-mt-2 mb-3 text-sm text-slate-500"><InlineText text={q.help} /></p>}
          <Choices q={q} value={value} onChange={onChange} invalid={!!error} />
        </fieldset>
      ) : (
        <>
          <label htmlFor={id} id={labelId} className="mb-3 block text-base text-slate-900">{label}</label>
          {q.help && <p id={`${id}-help`} className="-mt-2 mb-3 text-sm text-slate-500"><InlineText text={q.help} /></p>}
          <TextInput id={id} q={q} value={typeof value === 'string' ? value : ''} onChange={onChange} describedBy={describedBy} invalid={!!error} />
        </>
      )}
      {error && <p id={errorId} className="mt-3 flex items-center gap-1.5 text-sm font-medium text-red-700"><span aria-hidden="true">⚠</span>{error}</p>}
    </div>
  );
}

function TextInput({ id, q, value, onChange, describedBy, invalid }: {
  id: string; q: FormQuestion; value: string; onChange: (v: string) => void; describedBy?: string; invalid: boolean;
}) {
  const common = {
    id,
    name: q.id,
    value,
    required: q.required,
    'aria-invalid': invalid || undefined,
    'aria-describedby': describedBy,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    className: 'input',
  };
  if (q.kind === 'paragraph') return <textarea {...common} rows={4} maxLength={3000} />;
  const attrs: Record<string, string | number> =
    q.kind === 'email' ? { type: 'email', inputMode: 'email', autoComplete: q.mapsTo === 'email' ? 'email' : 'off' }
    : q.kind === 'phone' ? { type: 'tel', inputMode: 'tel', autoComplete: 'tel' }
    : q.kind === 'number' ? { type: 'text', inputMode: 'numeric', pattern: '[0-9]*', maxLength: 3 }
    : { type: 'text', maxLength: 300, autoComplete: q.mapsTo === 'full_name' ? 'name' : q.mapsTo === 'organization' ? 'organization' : 'off' };
  return <input {...common} {...attrs} className={`input ${q.kind === 'number' ? 'max-w-32' : 'sm:max-w-md'}`} />;
}

function Choices({ q, value, onChange, invalid }: { q: FormQuestion; value: Answer | undefined; onChange: (v: Answer) => void; invalid: boolean }) {
  const multi = q.kind === 'checkbox';
  const selected = multi ? (Array.isArray(value) ? value : []) : typeof value === 'string' ? [value] : [];
  const other = selected.find((v) => v.startsWith(OTHER_PREFIX.trim()));
  const otherText = other ? other.slice(OTHER_PREFIX.length) : '';

  const toggle = (label: string) => {
    if (!multi) return onChange(label);
    onChange(selected.includes(label) ? selected.filter((v) => v !== label) : [...selected, label]);
  };
  const setOther = (checked: boolean, text = otherText) => {
    const v = OTHER_PREFIX + text;
    if (!multi) return onChange(checked ? v : '');
    const rest = selected.filter((s) => s !== other);
    onChange(checked ? [...rest, v] : rest);
  };

  const box = multi
    ? 'mt-0.5 size-5 shrink-0 rounded accent-navy'
    : 'mt-0.5 size-5 shrink-0 accent-navy';

  return (
    <div className="space-y-1">
      {(q.options ?? []).map((o) => (
        <label key={o.label} className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2.5 hover:bg-slate-50">
          <input
            type={multi ? 'checkbox' : 'radio'}
            name={q.id}
            className={box}
            checked={selected.includes(o.label)}
            aria-invalid={invalid || undefined}
            onChange={() => toggle(o.label)}
          />
          <span className="min-w-0 text-[0.95rem] leading-snug text-slate-800">
            <InlineText text={o.label} />
            {o.image && <img src={imageUrl(o.image)} alt="" loading="lazy" className="mt-2 w-32 rounded-md sm:w-36" width={260} height={325} />}
          </span>
        </label>
      ))}
      {q.allowOther && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg px-2 py-2">
          <label className="flex cursor-pointer items-center gap-3">
            <input type={multi ? 'checkbox' : 'radio'} name={q.id} className={box} checked={!!other} onChange={(e) => setOther(e.target.checked)} />
            <span className="text-[0.95rem] text-slate-800">Other:</span>
          </label>
          <input
            aria-label={`Other answer for: ${q.label.replace(/\*\*/g, '')}`}
            className="min-w-0 flex-1 border-0 border-b border-slate-300 bg-transparent px-1 py-1 text-[0.95rem] focus:border-navy focus:outline-none"
            value={otherText}
            maxLength={300}
            onChange={(e) => setOther(true, e.target.value)}
            onFocus={() => !other && setOther(true)}
          />
        </div>
      )}
      {!multi && !q.required && selected.length > 0 && (
        <button type="button" className="ml-2 text-sm font-medium text-navy-light hover:underline" onClick={() => onChange('')}>
          Clear selection
        </button>
      )}
    </div>
  );
}
