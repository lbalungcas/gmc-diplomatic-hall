import { Fragment, type ReactNode } from 'react';

// Renders the form's tiny Markdown subset (see supabase/functions/_shared/form.ts) as React
// elements — never as HTML, so admin-entered text can't inject markup or scripts.

const SAFE_URL = /^(https?:\/\/|mailto:|\/)/i;
const TOKEN = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function inline(text: string, keyPrefix = ''): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const key = `${keyPrefix}${i++}`;
    if (m[1] !== undefined) {
      out.push(<strong key={key} className="font-semibold text-slate-900">{inline(m[1], `${key}-`)}</strong>);
    } else {
      const url = m[3];
      out.push(
        SAFE_URL.test(url) ? (
          <a key={key} href={url} target={url.startsWith('mailto:') ? undefined : '_blank'} rel="noreferrer" className="font-medium text-navy-light underline underline-offset-2 hover:text-navy">
            {inline(m[2], `${key}-`)}
          </a>
        ) : (
          <Fragment key={key}>{m[2]}</Fragment>
        ),
      );
    }
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Inline text with single newlines kept as line breaks (for labels and titles). */
export function InlineText({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {inline(line, `${i}-`)}
        </Fragment>
      ))}
    </>
  );
}

/** Paragraphs (blank-line separated), "- " bullet lists and line breaks. */
export function RichText({ text, className = '' }: { text: string; className?: string }) {
  const blocks = text.trim().split(/\n\s*\n/);
  return (
    <div className={`space-y-3 leading-relaxed ${className}`}>
      {blocks.map((block, bi) => {
        const lines = block.split('\n');
        if (lines.every((l) => /^\s*-\s+/.test(l))) {
          return (
            <ul key={bi} className="list-disc space-y-2 pl-5">
              {lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*-\s+/, ''), `${bi}-${li}-`)}</li>)}
            </ul>
          );
        }
        return <p key={bi}><InlineText text={block} /></p>;
      })}
    </div>
  );
}
