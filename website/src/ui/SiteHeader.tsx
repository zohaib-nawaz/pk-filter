import type { NavLink } from '../core/content';
import { Logo } from './Icon';

interface SiteHeaderProps {
  links: NavLink[];
  repoUrl: string;
}

export function SiteHeader({ links, repoUrl }: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-neutral-200/70 bg-white/85 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/85">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <a href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <Logo className="h-7 w-7" />
          <span>PK Access Filter</span>
        </a>
        <nav aria-label="Main" className="hidden items-center gap-7 text-sm text-neutral-600 md:flex dark:text-neutral-300">
          {links.map((link) => (
            <a key={link.href} href={link.href} className="transition-colors hover:text-neutral-950 dark:hover:text-white">
              {link.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <a
            href={repoUrl}
            className="hidden rounded-lg px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 sm:inline-flex dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            GitHub
          </a>
          <a href="/#install" className="rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700">
            Get the extension
          </a>
          <details className="relative md:hidden">
            <summary className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-lg border border-neutral-200 dark:border-neutral-700" aria-label="Menu">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </summary>
            <nav aria-label="Mobile" className="absolute right-0 mt-2 flex w-48 flex-col rounded-xl border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
              {links.map((link) => (
                <a key={link.href} href={link.href} className="rounded-lg px-3 py-2 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800">
                  {link.label}
                </a>
              ))}
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
