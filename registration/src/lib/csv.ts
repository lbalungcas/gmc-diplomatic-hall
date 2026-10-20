import Papa from 'papaparse';
import { answerText, plainText, questions, type FormSchema } from './form';
import type { Registration } from './types';

// Spreadsheet apps execute cells starting with these characters as formulas (CSV injection).
const safe = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};

const yesNo = (b: boolean) => (b ? 'yes' : 'no');

/** One row per registrant: status columns, then every form question in form order. */
export function registrationsToCsv(rows: Registration[], schema: FormSchema): string {
  const qs = questions(schema);
  const known = new Set(qs.map((q) => q.id));
  // Answers to questions that were later removed from the form are kept, under their id.
  const orphanIds = [...new Set(rows.flatMap((r) => Object.keys(r.answers ?? {})).filter((id) => !known.has(id)))];

  const columns: [string, (r: Registration) => unknown][] = [
    ['Status', (r) => r.status],
    ['Registered at', (r) => r.created_at],
    ...qs.map((q): [string, (r: Registration) => unknown] => [plainText(q.label), (r) => answerText(r.answers?.[q.id])]),
    ...orphanIds.map((id): [string, (r: Registration) => unknown] => [`(removed question) ${id}`, (r) => answerText(r.answers?.[id])]),
    ['Guardian name', (r) => r.guardian_name],
    ['Guardian email', (r) => r.guardian_email],
    ['Guardian consent', (r) => (r.age_group === 'under-18' ? yesNo(r.guardian_consent) : '')],
    ['Photo consent', (r) => yesNo(r.photo_consent)],
    ['Privacy consent', (r) => yesNo(r.privacy_consent)],
    ['Decline reason', (r) => r.decline_reason],
    ['Source', (r) => r.source],
    ['Decided at', (r) => r.decided_at],
    ['Checked in at', (r) => r.checked_in_at],
  ];

  return Papa.unparse({
    fields: columns.map(([h]) => h),
    data: rows.map((r) => columns.map(([, get]) => safe(get(r)))),
  });
}

export function downloadFile(name: string, content: string, type = 'text/csv;charset=utf-8') {
  // BOM so Excel opens UTF-8 names (ñ, é, …) correctly.
  const blob = new Blob(['﻿', content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
