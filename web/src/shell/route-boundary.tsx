import { Folder, Wrench } from 'lucide-react';
import { Component, type ReactNode } from 'react';
import { navigate, type Section } from '@/lib/router';
import { Button } from '@/components/ui/button';
import { PageGate } from '@/components/page-gate';
import { t } from '@/lib/i18n';

/**
 * The floor under every routed view.
 *
 * Without this, anything thrown during render — including the error
 * lazyRoute deliberately rethrows once its one-reload guard is spent —
 * unmounted the whole root and left a silent blank window, which is the
 * exact symptom lazyRoute exists to remove. Keyed on the section by the
 * caller, so navigating anywhere else discards the crashed instance and
 * gives the next view a clean start.
 *
 * `at` is the whole address, and a change to it clears the failure. The
 * key alone was not enough: it only moves between sections, so one bad
 * study link put this page in front of every study, the study list and
 * the sidebar's own Studies item until the reader went somewhere else
 * first (measured on the demo). A view that throws again on the new
 * address lands back here, which is the right answer for that address.
 */
export class RouteErrorBoundary extends Component<{ at: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidUpdate(prev: { at: string }): void {
    // oxlint-disable-next-line react/no-did-update-set-state -- guarded, and the reset is the point
    if (this.state.failed && prev.at !== this.props.at) this.setState({ failed: false });
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <PageGate
        icon={Wrench}
        title={t('Something went wrong')}
        body={t('This page hit an error it could not recover from. Reloading usually clears it, and nothing in your vault is affected.')}
        actions={
          <>
            <Button variant="secondary" onClick={() => location.reload()}>{t('Reload')}</Button>
            <Button variant="ghost" onClick={() => navigate('home')}>
              {t('Go home')}
            </Button>
          </>
        }
      />
    );
  }
}

/** Unreachable in practice — every section is routed above, and the router
    resolves anything unknown to the board. Kept as a defensive fallback so a
    future section without a handler degrades gracefully instead of blanking. */
export function Placeholder({ section }: { section: Section }) {
  return (
    <PageGate
      icon={Folder}
      title={section}
      titleClassName="capitalize"
      body={t("This page isn't available.")}
    />
  );
}
