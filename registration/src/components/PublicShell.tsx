import type { ReactNode } from 'react';
import { publicUrl } from '../lib/paths';

const MAIN_SITE = 'https://youthinnovationsmarketplace.org/';

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <a href={MAIN_SITE} aria-label="Youth Innovations Marketplace home">
            <img src={publicUrl('brand/logo.png')} alt="Youth Innovations Marketplace" className="h-11 w-auto" width="179" height="80" />
          </a>
          <a href={MAIN_SITE} className="text-sm font-semibold text-navy hover:underline">
            Event website →
          </a>
        </div>
        <div className="h-1 bg-sun" aria-hidden="true" />
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:py-10">{children}</main>
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-3xl px-4 py-8 text-center">
          <p className="mb-4 text-xs font-semibold tracking-widest text-slate-500 uppercase">Co-convened &amp; supported by</p>
          <img
            src={publicUrl('brand/partners.png')}
            alt="Violence Ends With Us (VEWU), Kindernothilfe, Terre des Hommes Netherlands; supported by German Cooperation and co-funded by the European Union"
            className="mx-auto w-full max-w-md"
            loading="lazy"
          />
          <p className="mt-6 text-xs text-slate-500">
            A satellite event of the 2nd Global Ministerial Conference on Ending Violence Against Children.
          </p>
        </div>
      </footer>
    </div>
  );
}
