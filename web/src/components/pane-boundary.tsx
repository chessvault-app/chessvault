import { Component, type ReactNode } from 'react';
import { Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { t } from '@/lib/i18n';

/**
 * The floor under one pane, so a throw inside it costs that pane and not
 * the page. The route's own boundary (App) stays the floor under
 * everything else: it replaces the whole view, which is right for a page
 * that cannot draw and wrong for an explorer that choked on one reply
 * while the board beside it is fine.
 *
 * Try again remounts the children. A pane that throws again lands back
 * here, which is the right answer for it.
 */
export class PaneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    console.error(error);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <EmptyState
        icon={Wrench}
        title={t('Something went wrong')}
        body={t('This panel hit an error. The rest of the page still works.')}
        action={
          <Button size="sm" onClick={() => this.setState({ failed: false })}>
            {t('Try again')}
          </Button>
        }
      />
    );
  }
}
