import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ISSUES_URL } from './core/config';
import { DownloadPage } from './pages/DownloadPage';
import { HomePage } from './pages/HomePage';
import { PrivacyPage } from './pages/PrivacyPage';
import { PageShell } from './ui/PageShell';
import './styles.css';

function mount(page: ReactNode): void {
  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <PageShell>{page}</PageShell>
    </StrictMode>,
  );
}

export function mountHome(): void {
  mount(<HomePage />);
}

export function mountPrivacy(): void {
  mount(<PrivacyPage issuesUrl={ISSUES_URL} />);
}

export function mountDownload(): void {
  mount(<DownloadPage />);
}
