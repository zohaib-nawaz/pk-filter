import { BRAND } from '@shared/brand';
import { TIKTOK_PERMISSION_URL } from '../core/config';
import { Logo } from './Icon';

interface SiteFooterProps {
  repoUrl: string;
  issuesUrl: string;
}

export function SiteFooter({ repoUrl, issuesUrl }: SiteFooterProps) {
  return (
    <footer className="border-t border-neutral-200 dark:border-neutral-800">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 text-sm text-neutral-600 sm:px-6 md:flex-row md:items-start md:justify-between dark:text-neutral-400">
        <div className="flex max-w-sm flex-col gap-2">
          <span className="flex items-center gap-2 font-semibold text-neutral-900 dark:text-neutral-100">
            <Logo className="h-6 w-6" />
            {BRAND.name}
          </span>
          <p>
            Measurements cross-checked with{' '}
            <a href="https://ooni.org" className="underline hover:text-neutral-900 dark:hover:text-white">
              OONI
            </a>
            . Country data from{' '}
            <a href="https://db-ip.com" className="underline hover:text-neutral-900 dark:hover:text-white">
              IP to Country Lite by DB-IP
            </a>{' '}
            (CC BY 4.0).
          </p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
          <a href="/privacy.html" className="hover:text-neutral-900 dark:hover:text-white">
            Privacy
          </a>
          <a href={repoUrl} className="hover:text-neutral-900 dark:hover:text-white">
            Source code
          </a>
          <a href={issuesUrl} className="hover:text-neutral-900 dark:hover:text-white">
            Report a problem
          </a>
          <a href={TIKTOK_PERMISSION_URL} className="hover:text-neutral-900 dark:hover:text-white">
            TikTok permission
          </a>
        </nav>
      </div>
    </footer>
  );
}
