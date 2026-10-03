import { FileX } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { navigate } from '@/lib/router';

/**
 * A puzzle book the server refused for a reason it names, said where the
 * book, one of its puzzles or its correction would stand. A vault part way
 * through a restore refuses them all until it is put back
 * (server/restore.ts): the book page said the book was not on the shelf
 * and may have been removed, and the trainer and the corrector stood on
 * their placeholder for good. The frame and the words are the ones a note
 * or a study that will not open takes, with the server's sentence under
 * them.
 */
export function BookRefused({ reason }: { reason: string }) {
  return (
    <div className="optical-center h-full">
      <EmptyState
        ground
        icon={FileX}
        title="The puzzle book could not be opened"
        body={reason}
        action={<Button onClick={() => navigate('puzzles', 'books')}>{t('Back to Puzzle books')}</Button>}
      />
    </div>
  );
}
