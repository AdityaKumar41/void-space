'use client';

import { useEffect, useState } from 'react';

import type { LanguageCode } from '@void-space/types';
import { canChangeLanguage } from '@void-space/types';

import { LANGUAGES, useLanguage } from '../../../lib/language';
import { useSession } from '../../../lib/session';

export default function SettingsPage() {
  const { session } = useSession();
  const allowed = canChangeLanguage(session?.user.email);
  const { language, setLanguage, t } = useLanguage();
  const [selected, setSelected] = useState<LanguageCode>(language);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<'saved' | 'error' | null>(null);

  useEffect(() => setSelected(language), [language]);

  async function save(nextLanguage: LanguageCode) {
    setSelected(nextLanguage);
    setFeedback(null);
    setSaving(true);
    try {
      await setLanguage(nextLanguage);
      setFeedback('saved');
    } catch {
      setSelected(language);
      setFeedback('error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <header className="border-b border-hairline pb-6">
        <p className="eyebrow">{t('Account settings')}</p>
        <h1 className="mt-2 text-ink">{t('Settings')}</h1>
      </header>

      <section aria-labelledby="language-heading" className="max-w-3xl">
        <div className="border-b border-hairline pb-5">
          <h2 id="language-heading" className="text-lg font-semibold text-ink">
            {t('Language and region')}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-dim">
            {t('Choose the language used across VOID·SPACE. Your choice follows your account across workspaces.')}
          </p>
        </div>

        {allowed ? (
          <>
            <div className="grid gap-3 border-b border-hairline py-5 sm:grid-cols-[minmax(0,1fr)_minmax(220px,280px)] sm:items-center">
              <label htmlFor="preferred-language" className="text-sm font-medium text-ink">
                {t('Language')}
              </label>
              <select
                id="preferred-language"
                value={selected}
                disabled={saving}
                onChange={(event) => void save(event.target.value as LanguageCode)}
                className="h-10 w-full rounded-control border border-hairline bg-surface px-3 text-sm text-ink focus:border-brand focus:outline-none disabled:opacity-60"
              >
                {LANGUAGES.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <p aria-live="polite" className="mt-3 min-h-5 text-sm text-ink-dim">
              {saving
                ? t('Saving…')
                : feedback === 'saved'
                  ? t('Language preference saved.')
                  : feedback === 'error'
                    ? t('Could not save your language preference. Try again.')
                    : null}
            </p>
          </>
        ) : (
          <p className="mt-4 rounded-card border border-hairline px-4 py-3 text-sm leading-6 text-ink-dim">
            {t('Only the platform admin and creator can change the display language. Your account is on the language they have set for the platform.')}
          </p>
        )}
      </section>
    </div>
  );
}
