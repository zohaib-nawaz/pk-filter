import { useMemo, useState } from 'react';
import { AUTO_COUNTRY, countryOptions } from '@shared/countries';
import { STATUS_META } from '@shared/status-meta';
import { RELEASES_URL } from '../core/config';
import { FAQ, FEATURES, INSTALL_GUIDES, SITE_OWNER_SNIPPET, STATUS_HELP, STEPS } from '../core/content';
import { useSiteCheck } from '../hooks/useSiteCheck';
import { Checker } from '../ui/Checker';
import { CodeBlock } from '../ui/CodeBlock';
import { FaqList } from '../ui/FaqList';
import { FeatureGrid } from '../ui/FeatureGrid';
import { InstallTabs } from '../ui/InstallTabs';
import { SearchMock, type MockResult } from '../ui/SearchMock';
import { SectionHeading } from '../ui/SectionHeading';
import { Steps } from '../ui/Steps';

const EXAMPLES = ['wikipedia.org', 'x.com', 'proton.me'];

const MOCK_RESULTS: MockResult[] = [
  { site: 'Wikipedia', url: 'en.wikipedia.org', title: 'Internet censorship', status: { label: STATUS_META.accessible.label, color: STATUS_META.accessible.color } },
  { site: 'Example News', url: 'news.example.com', title: 'Live coverage and analysis', status: { label: STATUS_META.blocked.label, color: STATUS_META.blocked.color } },
  { site: 'Forum', url: 'forum.example.org', title: 'Community discussion', status: { label: 'Blocked on some ISPs', color: STATUS_META.possibly_blocked.color } },
];

const SECTION = 'mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6';

export function HomePage() {
  const { state, check } = useSiteCheck();
  const [installFor, setInstallFor] = useState('chrome');
  const countries = useMemo(() => [{ value: AUTO_COUNTRY, label: 'My country (from my IP)' }, ...countryOptions()], []);
  const statuses = STATUS_HELP.map((item) => ({ label: STATUS_META[item.status].label, color: STATUS_META[item.status].color, text: item.text }));

  return (
    <main>
      <section className="relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 -z-10 h-[32rem] bg-gradient-to-b from-emerald-50 to-transparent dark:from-emerald-950/30" aria-hidden />
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-16 pb-20 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:pt-24">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-3 py-1 text-sm font-medium text-emerald-800 dark:border-emerald-900 dark:bg-neutral-900 dark:text-emerald-300">
              Free browser extension for Chrome, Edge and Firefox
            </p>
            <h1 className="mt-6 text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">Know which sites are blocked before you click.</h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-neutral-600 dark:text-neutral-300">
              Badges on Google, Bing and DuckDuckGo show whether each result opens in Pakistan, or wherever your VPN connects. Measured on real networks, cross-checked with OONI.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#install" className="rounded-xl bg-emerald-600 px-5 py-3 text-base font-semibold text-white shadow-sm hover:bg-emerald-700">
                Get the extension
              </a>
              <a href="#check" className="rounded-xl border border-neutral-300 bg-white px-5 py-3 text-base font-semibold hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800">
                Check a site now
              </a>
            </div>
          </div>
          <SearchMock query="internet censorship" results={MOCK_RESULTS} />
        </div>
      </section>

      <section id="features" className={SECTION}>
        <SectionHeading eyebrow="Features" title="Everything you need to browse around blocks." text="Simple by default. Every extra is optional and asks for permission only when you turn it on." />
        <FeatureGrid features={FEATURES} />
      </section>

      <section id="check" className="scroll-mt-20 border-y border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="mx-auto max-w-4xl px-4 py-20 sm:px-6">
          <SectionHeading eyebrow="Try it" title="Is a site blocked where you are?" text="Uses the same checks as the extension. Pick a country, or leave it on your own to test through your VPN." />
          <Checker state={state} countries={countries} examples={EXAMPLES} onCheck={(input, country) => void check(input, country)} />
        </div>
      </section>

      <section id="how" className={SECTION}>
        <SectionHeading eyebrow="How it works" title="Three independent signals, one honest badge." />
        <Steps steps={STEPS} statuses={statuses} />
      </section>

      <section id="install" className="scroll-mt-20 border-y border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950">
        <div className="mx-auto max-w-4xl px-4 py-20 sm:px-6">
          <SectionHeading eyebrow="Install" title="Up and running in a minute." text="Store listings are on the way. Until then, load the extension from the releases page." />
          <InstallTabs guides={INSTALL_GUIDES} selected={installFor} releasesUrl={RELEASES_URL} onSelect={setInstallFor} />
        </div>
      </section>

      <section id="owners" className={SECTION}>
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <SectionHeading
            eyebrow="For website owners"
            title="Let visitors download your own videos."
            text="Point the extension to the full file behind your player. It is only used for the download button; your player keeps working as before."
          />
          <CodeBlock code={SITE_OWNER_SNIPPET} label="index.html" />
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-4 pb-24 sm:px-6">
        <SectionHeading eyebrow="FAQ" title="Questions people ask." />
        <FaqList questions={FAQ} />
      </section>
    </main>
  );
}
