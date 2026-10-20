import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Modal } from '../../components/Modal';
import {
  CORE_FIELDS, DEFAULT_FORM, plainText, resolveForm, SUBMIT, validateSchema,
  type CoreField, type FormBlock, type FormOption, type FormQuestion, type FormSchema, type FormSection, type QuestionKind,
} from '../../lib/form';
import { formatDateTime } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { useEvent } from '../../lib/useEvent';
import Register from '../Register';

const KINDS: { value: QuestionKind; label: string }[] = [
  { value: 'short', label: 'Short answer' },
  { value: 'paragraph', label: 'Paragraph' },
  { value: 'radio', label: 'Multiple choice (one answer)' },
  { value: 'checkbox', label: 'Checkboxes (several answers)' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone number' },
  { value: 'number', label: 'Number' },
];

const uid = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

function move<T>(list: T[], from: number, to: number) {
  if (to < 0 || to >= list.length) return;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
}

interface Version {
  id: number;
  at: string;
  actor_email: string | null;
  action: string;
  after: FormSchema | null;
}

export default function FormEditor() {
  const { event, reload } = useEvent();
  const [draft, setDraft] = useState<FormSchema | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [preview, setPreview] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [versions, setVersions] = useState<Version[]>([]);
  const [registrations, setRegistrations] = useState(0);

  useEffect(() => {
    if (!event || dirty) return;
    setDraft(clone(resolveForm(event.form_schema)));
  }, [event, dirty]);

  useEffect(() => {
    if (!event) return;
    supabase.from('registrations').select('id', { count: 'exact', head: true }).eq('event_id', event.id)
      .then(({ count }) => setRegistrations(count ?? 0));
  }, [event]);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const update = useCallback((fn: (d: FormSchema) => void) => {
    setDraft((d) => {
      if (!d) return d;
      const next = clone(d);
      fn(next);
      return next;
    });
    setDirty(true);
    setMessage(null);
  }, []);

  const liveProblems = useMemo(() => (draft ? validateSchema(draft) : []), [draft]);

  async function save() {
    if (!draft || !event) return;
    const issues = validateSchema(draft);
    setProblems(issues);
    if (issues.length) {
      setMessage({ ok: false, text: 'Fix the problems listed above before saving.' });
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc('save_form_schema', { p_event: event.id, p_schema: draft });
    setSaving(false);
    if (error) {
      setMessage({ ok: false, text: error.message });
      return;
    }
    setDirty(false);
    setMessage({ ok: true, text: 'Saved. The public registration form now shows this version.' });
    reload();
  }

  async function resetToDefault() {
    if (!event || !window.confirm('Replace the form with the original built-in version? Your current form stays in Version history.')) return;
    const { error } = await supabase.rpc('save_form_schema', { p_event: event.id, p_schema: null });
    if (error) return setMessage({ ok: false, text: error.message });
    setDirty(false);
    setDraft(clone(DEFAULT_FORM));
    setMessage({ ok: true, text: 'Restored the original form.' });
    reload();
  }

  async function openHistory() {
    if (!event) return;
    const { data } = await supabase.from('audit_log').select('id, at, actor_email, action, after')
      .eq('event_id', event.id).in('action', ['edit_form', 'reset_form']).order('at', { ascending: false }).limit(50);
    setVersions((data ?? []) as Version[]);
    setShowHistory(true);
  }

  if (!event || !draft) return <p className="text-slate-500">Loading…</p>;

  const sectionChoices = draft.sections.map((s, i) => ({ id: s.id, label: `Section ${i + 1}${s.title ? ` · ${plainText(s.title).slice(0, 40)}` : ''}` }));

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="sticky top-0 z-20 -mx-4 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur">
        <h1 className="mr-auto text-2xl font-bold">Registration form</h1>
        {dirty && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">Unsaved changes</span>}
        <button className="btn-ghost" onClick={openHistory}>Version history</button>
        <button className="btn-ghost" onClick={() => setPreview(true)}>Preview</button>
        {dirty && <button className="btn-ghost" onClick={() => { setDirty(false); setProblems([]); }}>Discard changes</button>}
        <button className="btn-primary" onClick={save} disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save & publish'}</button>
      </div>

      {message && (
        <p role="status" className={`rounded-lg px-4 py-2.5 text-sm font-medium ${message.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900'}`}>{message.text}</p>
      )}
      {(problems.length > 0 || (dirty && liveProblems.length > 0)) && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-semibold">This form can't be saved yet:</p>
          <ul className="mt-1 list-disc pl-5">{(dirty ? liveProblems : problems).map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}

      <div className="card space-y-2 p-4 text-sm text-slate-600">
        <p>
          Changes go live on the public form as soon as you <strong>Save &amp; publish</strong>.{' '}
          {registrations > 0 && (
            <strong className="text-amber-800">
              {registrations} people have already registered — editing or removing a question doesn't change their saved answers,
              and answers to removed questions stay in the CSV export.
            </strong>
          )}
        </p>
        <p>
          Formatting: <code className="rounded bg-slate-100 px-1">**bold**</code>,{' '}
          <code className="rounded bg-slate-100 px-1">[link text](https://…)</code>, lines starting with{' '}
          <code className="rounded bg-slate-100 px-1">- </code> become bullets, and a blank line starts a new paragraph.
        </p>
        <p>
          The data privacy consent, optional photo consent and (for under-18s) parent/guardian consent are always added by the
          system and aren't part of this editor.
        </p>
      </div>

      {draft.sections.map((section, si) => (
        <SectionEditor
          key={section.id}
          section={section}
          index={si}
          count={draft.sections.length}
          sectionChoices={sectionChoices}
          update={(fn) => update((d) => fn(d.sections[si]))}
          onMove={(dir) => update((d) => move(d.sections, si, si + dir))}
          onDelete={() => {
            if (window.confirm(`Delete section ${si + 1} and everything in it?`)) {
              update((d) => {
                d.sections.splice(si, 1);
                // Drop jumps that pointed at the deleted section.
                for (const s of d.sections) {
                  if (s.next === section.id) delete s.next;
                  for (const b of s.blocks) if (b.type === 'question') for (const o of b.options ?? []) if (o.goTo === section.id) delete o.goTo;
                }
              });
            }
          }}
          onAddSectionBelow={() => update((d) => d.sections.splice(si + 1, 0, { id: uid('s'), title: 'New section', blocks: [] }))}
          usedMappings={new Set(draft.sections.flatMap((s) => s.blocks).filter((b): b is FormQuestion => b.type === 'question' && !!b.mapsTo).map((q) => q.mapsTo!))}
        />
      ))}

      <div className="flex flex-wrap justify-between gap-2 pb-10">
        <button className="btn-ghost" onClick={() => update((d) => d.sections.push({ id: uid('s'), title: 'New section', blocks: [] }))}>+ Add section</button>
        <button className="text-sm font-semibold text-red-700 hover:underline" onClick={resetToDefault}>Restore the original form…</button>
      </div>

      {preview && (
        <Modal title="Preview — exactly what registrants see" onClose={() => setPreview(false)} wide>
          <div className="bg-slate-50 p-1">
            <Register previewSchema={draft} />
          </div>
        </Modal>
      )}

      {showHistory && (
        <Modal title="Version history" onClose={() => setShowHistory(false)} wide>
          {versions.length === 0 ? (
            <p className="text-sm text-slate-500">No saved edits yet — the form is the original version.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {versions.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span>
                    <strong>{formatDateTime(v.at)}</strong> · {v.actor_email ?? 'unknown'} ·{' '}
                    {v.action === 'reset_form' ? 'restored the original form' : `saved (${v.after?.sections?.length ?? 0} sections)`}
                  </span>
                  <button
                    className="btn-ghost px-3 py-1.5"
                    onClick={() => {
                      setDraft(clone(v.after ?? DEFAULT_FORM));
                      setDirty(true);
                      setShowHistory(false);
                      setMessage({ ok: true, text: 'Loaded that version into the editor. Review it, then Save & publish to make it live.' });
                    }}
                  >
                    Load this version
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </div>
  );
}

// ───────────────────────── section ─────────────────────────

function SectionEditor({ section, index, count, sectionChoices, update, onMove, onDelete, onAddSectionBelow, usedMappings }: {
  section: FormSection;
  index: number;
  count: number;
  sectionChoices: { id: string; label: string }[];
  update: (fn: (s: FormSection) => void) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
  onAddSectionBelow: () => void;
  usedMappings: Set<CoreField>;
}) {
  const [open, setOpen] = useState(index < 1);
  const targets = sectionChoices.filter((c) => c.id !== section.id);

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 bg-navy px-4 py-2.5 text-white">
        <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          <span className="font-semibold">Section {index + 1} of {count}</span>
          <span className="truncate text-white/75">{section.title ? plainText(section.title) : '(no title)'}</span>
          <span className="text-xs text-white/60">· {section.blocks.length} item{section.blocks.length === 1 ? '' : 's'}</span>
        </button>
        <IconButton label="Move section up" onClick={() => onMove(-1)} disabled={index === 0} dark>↑</IconButton>
        <IconButton label="Move section down" onClick={() => onMove(1)} disabled={index === count - 1} dark>↓</IconButton>
        <IconButton label="Delete section" onClick={onDelete} disabled={count === 1} dark>🗑</IconButton>
      </div>

      {open && (
        <div className="space-y-4 p-4">
          <TextArea label="Section title" value={section.title ?? ''} rows={1} onChange={(v) => update((s) => { s.title = v || undefined; })} />
          <TextArea label="Section description" value={section.description ?? ''} rows={3} onChange={(v) => update((s) => { s.description = v || undefined; })} />

          {section.blocks.map((block, bi) => (
            <BlockEditor
              key={block.id}
              block={block}
              first={bi === 0}
              last={bi === section.blocks.length - 1}
              targets={targets}
              usedMappings={usedMappings}
              update={(fn) => update((s) => fn(s.blocks[bi]))}
              onMove={(dir) => update((s) => move(s.blocks, bi, bi + dir))}
              onDelete={() => update((s) => { s.blocks.splice(bi, 1); })}
              onDuplicate={() => update((s) => {
                const copy = clone(block);
                copy.id = uid(block.type === 'text' ? 't' : 'q');
                if (copy.type === 'question') delete copy.mapsTo;
                s.blocks.splice(bi + 1, 0, copy);
              })}
            />
          ))}

          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost" onClick={() => update((s) => s.blocks.push({ type: 'question', id: uid('q'), kind: 'short', label: 'New question', required: false }))}>+ Question</button>
            <button className="btn-ghost" onClick={() => update((s) => s.blocks.push({ type: 'text', id: uid('t'), title: '', body: 'New text' }))}>+ Title &amp; text</button>
            <button className="btn-ghost" onClick={onAddSectionBelow}>+ Section below</button>
          </div>

          <label className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4 text-sm">
            <span className="font-semibold text-slate-700">After this section:</span>
            <select className="input w-auto py-1.5 text-sm" value={section.next ?? ''} onChange={(e) => update((s) => { s.next = e.target.value || undefined; })}>
              <option value="">Continue to next section</option>
              {targets.map((t) => <option key={t.id} value={t.id}>Go to {t.label}</option>)}
              <option value={SUBMIT}>Submit form</option>
            </select>
            <span className="text-xs text-slate-500">A multiple-choice answer with its own "go to" takes priority.</span>
          </label>
        </div>
      )}
    </section>
  );
}

// ───────────────────────── block ─────────────────────────

function BlockEditor({ block, first, last, targets, usedMappings, update, onMove, onDelete, onDuplicate }: {
  block: FormBlock;
  first: boolean;
  last: boolean;
  targets: { id: string; label: string }[];
  usedMappings: Set<CoreField>;
  update: (fn: (b: FormBlock) => void) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const toolbar = (
    <div className="flex items-center gap-1">
      <IconButton label="Move up" onClick={() => onMove(-1)} disabled={first}>↑</IconButton>
      <IconButton label="Move down" onClick={() => onMove(1)} disabled={last}>↓</IconButton>
      <IconButton label="Duplicate" onClick={onDuplicate}>⧉</IconButton>
      <IconButton label="Delete" onClick={() => {
        const name = block.type === 'question' ? plainText(block.label) : 'this text block';
        if (block.type === 'question' && block.mapsTo && CORE_FIELDS.find((f) => f.key === block.mapsTo)?.mandatory) {
          window.alert(`"${name}" is linked to a required registration field. Link another question first, or edit this one instead.`);
          return;
        }
        if (window.confirm(`Delete "${name.slice(0, 80)}"?`)) onDelete();
      }}>🗑</IconButton>
    </div>
  );

  if (block.type === 'text') {
    return (
      <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold tracking-wide text-slate-500 uppercase">Title &amp; text</span>
          {toolbar}
        </div>
        <TextArea label="Title" value={block.title ?? ''} rows={1} onChange={(v) => update((b) => { (b as typeof block).title = v || undefined; })} />
        <TextArea label="Text" value={block.body} rows={Math.min(14, Math.max(3, block.body.split('\n').length + 1))} onChange={(v) => update((b) => { (b as typeof block).body = v; })} />
      </div>
    );
  }

  const q = block;
  const setQ = (fn: (q: FormQuestion) => void) => update((b) => fn(b as FormQuestion));
  const choice = q.kind === 'radio' || q.kind === 'checkbox';
  const mappingChoices = CORE_FIELDS.filter((f) => f.kinds.includes(q.kind) && (f.key === q.mapsTo || !usedMappings.has(f.key)));
  const lockedKind = !!q.mapsTo && !!CORE_FIELDS.find((f) => f.key === q.mapsTo)?.mandatory;

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold tracking-wide text-slate-500 uppercase">
          Question{q.mapsTo && <span className="ml-2 rounded bg-navy-surface px-1.5 py-0.5 text-navy normal-case">→ {CORE_FIELDS.find((f) => f.key === q.mapsTo)?.label}</span>}
        </span>
        {toolbar}
      </div>
      <TextArea label="Question" value={q.label} rows={Math.min(6, Math.max(1, q.label.split('\n').length))} onChange={(v) => setQ((x) => { x.label = v; })} />
      <TextArea label="Help text (optional)" value={q.help ?? ''} rows={1} onChange={(v) => setQ((x) => { x.help = v || undefined; })} />

      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label>
          <span className="mb-1 block text-xs font-semibold text-slate-500">Answer type</span>
          <select className="input w-auto py-1.5 text-sm" value={q.kind} disabled={lockedKind}
            title={lockedKind ? 'Linked to a required registration field' : undefined}
            onChange={(e) => setQ((x) => {
              x.kind = e.target.value as QuestionKind;
              const isChoice = x.kind === 'radio' || x.kind === 'checkbox';
              if (isChoice && !x.options?.length) x.options = [{ label: 'Option 1' }];
              if (!isChoice) { delete x.options; delete x.allowOther; }
              if (x.kind !== 'radio') x.options?.forEach((o) => delete o.goTo);
              if (x.mapsTo && !CORE_FIELDS.find((f) => f.key === x.mapsTo)?.kinds.includes(x.kind)) delete x.mapsTo;
            })}>
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2">
          <input type="checkbox" className="size-4 accent-navy" checked={q.required} disabled={lockedKind} onChange={(e) => setQ((x) => { x.required = e.target.checked; })} />
          Required
        </label>
        {choice && (
          <label className="flex items-center gap-2 pb-2">
            <input type="checkbox" className="size-4 accent-navy" checked={!!q.allowOther} onChange={(e) => setQ((x) => { x.allowOther = e.target.checked || undefined; })} />
            Add "Other:" option
          </label>
        )}
        <label>
          <span className="mb-1 block text-xs font-semibold text-slate-500">Saves to registration field</span>
          <select className="input w-auto py-1.5 text-sm" value={q.mapsTo ?? ''} disabled={lockedKind}
            onChange={(e) => setQ((x) => { x.mapsTo = (e.target.value || undefined) as CoreField | undefined; })}>
            <option value="">— none (answer only) —</option>
            {mappingChoices.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </label>
      </div>

      {choice && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-500">Options</p>
          {(q.options ?? []).map((o, oi) => (
            <OptionEditor
              key={oi}
              option={o}
              radio={q.kind === 'radio'}
              targets={targets}
              first={oi === 0}
              last={oi === (q.options?.length ?? 0) - 1}
              onChange={(fn) => setQ((x) => fn(x.options![oi]))}
              onMove={(dir) => setQ((x) => move(x.options!, oi, oi + dir))}
              onDelete={() => setQ((x) => { x.options!.splice(oi, 1); })}
            />
          ))}
          <button className="text-sm font-semibold text-navy-light hover:underline"
            onClick={() => setQ((x) => { x.options = [...(x.options ?? []), { label: `Option ${(x.options?.length ?? 0) + 1}` }]; })}>
            + Add option
          </button>
        </div>
      )}
    </div>
  );
}

function OptionEditor({ option, radio, targets, first, last, onChange, onMove, onDelete }: {
  option: FormOption;
  radio: boolean;
  targets: { id: string; label: string }[];
  first: boolean;
  last: boolean;
  onChange: (fn: (o: FormOption) => void) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}) {
  const [showImage, setShowImage] = useState(!!option.image);
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
      <div className="flex items-start gap-2">
        <span className="mt-2.5 text-slate-400" aria-hidden="true">{radio ? '○' : '☐'}</span>
        <textarea className="input min-h-10 flex-1 py-1.5 text-sm" rows={Math.min(5, Math.ceil(option.label.length / 90) || 1)} value={option.label}
          aria-label="Option text" onChange={(e) => onChange((o) => { o.label = e.target.value; })} />
        <div className="flex shrink-0 items-center">
          <IconButton label="Move option up" onClick={() => onMove(-1)} disabled={first}>↑</IconButton>
          <IconButton label="Move option down" onClick={() => onMove(1)} disabled={last}>↓</IconButton>
          <IconButton label="Image" onClick={() => setShowImage((s) => !s)}>🖼</IconButton>
          <IconButton label="Delete option" onClick={onDelete}>✕</IconButton>
        </div>
      </div>
      {(showImage || radio) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 pl-6 text-xs">
          {showImage && (
            <>
              {option.image && <img src={option.image} alt="" className="h-12 w-auto rounded" />}
              <input className="input min-w-48 flex-1 py-1 text-xs" placeholder="Image URL, e.g. /form/deal-corner.png or https://…" value={option.image ?? ''}
                aria-label="Option image URL" onChange={(e) => onChange((o) => { o.image = e.target.value.trim() || undefined; })} />
            </>
          )}
          {radio && (
            <label className="flex items-center gap-1">
              <span className="text-slate-500">If chosen:</span>
              <select className="input w-auto py-1 text-xs" value={option.goTo ?? ''} onChange={(e) => onChange((o) => { o.goTo = e.target.value || undefined; })}>
                <option value="">Continue as normal</option>
                {targets.map((t) => <option key={t.id} value={t.id}>Go to {t.label}</option>)}
                <option value={SUBMIT}>Submit form</option>
              </select>
            </label>
          )}
        </div>
      )}
    </div>
  );
}

function TextArea({ label, value, onChange, rows }: { label: string; value: string; onChange: (v: string) => void; rows: number }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-500">{label}</span>
      <textarea className="input py-2 text-sm" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function IconButton({ label, onClick, disabled, dark, children }: { label: string; onClick: () => void; disabled?: boolean; dark?: boolean; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}
      className={`grid size-8 place-items-center rounded-md text-sm disabled:opacity-30 ${dark ? 'hover:bg-white/15' : 'text-slate-600 hover:bg-slate-200'}`}>
      {children}
    </button>
  );
}
