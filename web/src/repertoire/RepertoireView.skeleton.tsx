import { ChevronRight, Play, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CardFooter } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Segmented } from '@/components/segmented';
import { Select } from '@/components/ui/select';
import { ClearableInput } from '@/components/text-fields';
import { KingIcon } from '@/components/king-icon';
import { Inert, Skeleton, SkeletonBoard } from '@/components/skeletons';
import { t } from '@/lib/i18n';

/**
 * The repertoire trainer while its chunk is on the wire.
 *
 * It drew NOTHING, along with the editor, the workspace and the opening
 * map — the four routes the shell's old guessing table had no shape for,
 * and the argument for leaving them blank was that inventing a shape out
 * in the shell would be guessing. True of the shell. This module is not
 * the shell: it is this page's own outline, in its own chunk, and it can
 * simply say what the page is. It is a board on the SCROLLING board
 * shell with a New game card beside it, and none of that waits on a
 * fetch — the page has no fetch at all, so its whole download was a
 * blank screen with a tab bar under it.
 *
 * The card is the real form, held inert, because every label and every
 * option in it is fixed: the mode, the side, the source, the opening,
 * and the press that starts. Only the values are this device's, and
 * those arrive with the page.
 */
export default function RepertoireOutline() {
  return (
    <SkeletonBoard
      shell="scroll"
      name={t('Repertoire')}
      // The drill plays a game, so both players' bars stand, as they do
      // on a collected game (PlayerSlot, above and below the board).
      players
      // No pane switcher: the page grows one only once a game is
      // running, and it is not running while the page is arriving.
      panes={[]}
      panel={{
        // The panel is called New game while its form is in it and Game
        // once a phone has folded the form into a sheet, which is the
        // same fold the page makes. Both words, folded by class, because
        // which one shows is a width and not an answer.
        title: (
          <>
            <span className="stacked:hidden">{t('New game')}</span>
            <span className="wide:hidden">{t('Game')}</span>
          </>
        ),
        fit: true,
        // The page's own two bands: the body, padded across and spaced by
        // its own gap, and the CardFooter the thing to press stands on.
        // Each fold's content sits directly in the band (`contents`), or
        // the band's gap has one child to space and spaces nothing: the
        // fields stood stacked with no air between them.
        body: (
          <>
            <div className={GAME_BODY}>
              <div className="contents stacked:hidden">
                <NewGameForm />
              </div>
              <div className="contents wide:hidden">
                <PhoneGameLines />
              </div>
            </div>
            <CardFooter className={GAME_FOOT}>
              <Inert>
                <Button variant="default" size="default" className="w-full">
                  <Play className="glyph" data-icon="inline-start" />
                  {t('Start')}
                </Button>
                <div className="contents wide:hidden">
                  <PhoneSetupRow />
                </div>
              </Inert>
            </CardFooter>
          </>
        ),
      }}
    />
  );
}

/**
 * What a phone shows instead of the form: the position the next game
 * would start from, one line saying what the mode does, the press that
 * begins, and the row that opens the settings sheet. The form itself is
 * behind that row, which is why the phone's panel is shorter.
 */
function PhoneGameLines() {
  return (
    <Inert>
      <p className="text-foreground text-base font-medium">{t('Starting position')}</p>
      <p className="text-muted-foreground text-sm">{t('Practise an opening against real games')}</p>
    </Inert>
  );
}

/** The row under Start that says what Start would play and opens the settings sheet. */
function PhoneSetupRow() {
  return (
    <div className="bg-card ring-card-ring flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 ring-1">
      <SlidersHorizontal className="text-muted-foreground glyph shrink-0" />
      <Skeleton className="h-2.5 min-w-0 flex-1" />
      <ChevronRight className="text-muted-foreground glyph shrink-0" />
    </div>
  );
}

/**
 * The Game and New game panels' two bands, which the page draws and this
 * outline draws: the body's frame, and the footer's.
 */
export const GAME_BODY = 'flex flex-col gap-3 px-(--card-spacing)';
export const GAME_FOOT = 'flex-col items-stretch gap-3';

/**
 * The form's own fields, in the page's own order and words, held inert.
 *
 * Each is the real control with no value in it: the two pairs are the
 * page's own Segmenteds (even halves, as it draws them), the source is
 * a Select showing its no-value dash, and the opening picker's trigger
 * is a field with the starting position's own placeholder. The mode
 * chosen decides whether a Study/Chapter pair stands where Opening does,
 * so what follows Source is the shorter of the two and the taller one
 * arrives into the space under Start.
 */
function NewGameForm() {
  return (
    <Inert>
      <Field label="Mode">
        <Segmented
          value="spar"
          onChange={NOOP}
          ariaLabel="Mode"
          even
          segments={[
            { value: 'spar', label: t('Free play') },
            { value: 'drill', label: t('Drill a study') },
          ]}
        />
      </Field>
      <Field label="Play as">
        <Segmented
          value="white"
          onChange={NOOP}
          ariaLabel="Play as"
          even
          segments={(['white', 'black'] as const).map((c) => ({
            value: c,
            label: (
              <>
                <KingIcon side={c} />
                {c === 'white' ? t('White') : t('Black')}
              </>
            ),
          }))}
        />
      </Field>
      <Field label="Source">
        <Select value="" onValueChange={NOOP} ariaLabel={t('Where replies come from')} steady groups={[{ options: [] }]} />
      </Field>
      <Field label="Opening">
        <ClearableInput value="" readOnly aria-label={t('Opening')} placeholder={t('Starting position')} />
      </Field>
    </Inert>
  );
}

const NOOP = (): void => {};
