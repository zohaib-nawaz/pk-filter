import type { ReactNode } from 'react';
import { ISSUES_URL, REPO_URL } from '../core/config';
import { NAV_LINKS } from '../core/content';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-30 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <SiteHeader links={NAV_LINKS} repoUrl={REPO_URL} />
      <div id="content" className="flex-1">
        {children}
      </div>
      <SiteFooter repoUrl={REPO_URL} issuesUrl={ISSUES_URL} />
    </div>
  );
}
