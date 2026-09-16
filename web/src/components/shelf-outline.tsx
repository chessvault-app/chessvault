import { PageHeader } from '@/components/page-header';
import { SearchInput } from '@/components/text-fields';
import { Inert, SkeletonSubtitle } from '@/components/skeletons';

/**
 * A shelf's header while its page is on the wire: the name, the count
 * line the shelf is about to print, and the search field.
 *
 * The field is the real one, held inert, on the rule the placeholders
 * already follow — a control whose shape is known before the data is is
 * drawn as ITSELF rather than as a grey box of its size (skeletons,
 * `INERT`). ShelfToolbar is PageHeader with this field in its search
 * slot, so this is the toolbar's own geometry rather than an impression
 * of it. What is left out is the row of buttons beside the title (sort,
 * layout, Create), which changes nothing about where the cards start;
 * without the field and the count line, the first card sat 71px high
 * (measured on the demo at 1280).
 *
 * Here rather than in each shelf's own outline module because the three
 * shelves hold the same kind of thing and had no business being
 * different sizes (NotesView's own note about the studies shelf). It is
 * reached only from those outline modules, so it rides their chunks and
 * costs the launch nothing.
 */
export function ShelfHeader({
  title,
  search,
  subtitle,
}: {
  title: string;
  /** The field's own placeholder, which is also its label. */
  search: string;
  /** Whether a count line is coming. The studies shelf drops it entirely
      on a vault with no studies, so the stored shape is what knows. */
  subtitle: boolean;
}) {
  return (
    <PageHeader
      title={title}
      subtitle={subtitle ? <SkeletonSubtitle /> : undefined}
      search={
        <Inert>
          <SearchInput
            type="text"
            inputSize="sm"
            value=""
            readOnly
            placeholder={search}
            aria-label={search}
            className="min-w-0 flex-1"
          />
        </Inert>
      }
    />
  );
}
