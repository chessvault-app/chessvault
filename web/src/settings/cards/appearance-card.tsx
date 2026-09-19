import { useState, type CSSProperties } from 'react';
import { Palette } from 'lucide-react';
import { Field } from '@/components/ui/field';
import { APPEARANCE_LABELS, SettingsCard as Card } from '@/settings/SettingsPage.skeleton';
import { Select } from '@/components/ui/select';
import { Disclosure } from '@/components/disclosure';
import { SettingRow } from '@/components/setting-row';
import { Switch } from '@/components/ui/switch';
import { useTheme, type ThemePreference } from '@/store/theme';
import { ANNOTATION_SIZES, BOARD_THEMES, CASTLE_STYLES, DENSITIES, PIECE_SETS, RADIUS_PRESETS, SCHEME_PRESETS, boardScheme, usePrefs, type AnnotationSize, type BoardTheme, type CastleStyle, type Density, type PieceSet, type RadiusId } from '@/store/prefs';
import { PIECE_THUMBS } from '@/pieces/thumbs';
import { t, getLang, setLang, LANGS, type Lang } from '@/lib/i18n';

// --- Appearance --------------------------------------------------------------

/**
 * The colour schemes, grouped the way SCHEME_PRESETS lists them.
 *
 * The first group was labelled "shadcn", which is the name of a build
 * dependency and meant nothing to the club player reading it — it is the
 * first heading in the first control on the Appearance page. These five
 * are the registry's base neutral ramps, so they are called that. The
 * headings go through `t()` at the Select, so they need Korean like any
 * other string; they did not have it, and `check:repo`'s new dictionary
 * check cannot see them because `t(group.label)` is a variable.
 */
const SCHEME_GROUPS = [
  { label: 'Neutrals', ids: ['default', 'stone', 'zinc', 'gray', 'shadcn-slate'] },
  { label: 'Coloured', ids: ['board', 'slate', 'paper', 'forest', 'rose', 'midnight', 'mono', 'graphite'] },
  { label: 'Contrast', ids: ['high-contrast'] },
].map(({ label, ids }) => ({
  label,
  options: ids.map((id) => {
    const preset = SCHEME_PRESETS.find((p) => p.id === id)!;
    const { accent, accentTint = 1, contrast = 0, tint, hue } = preset.scheme;
    return {
      value: preset.id,
      label: preset.label,
      // The dot the swatch row used to draw (lanph3re: keep it in the
      // dropdown). It has to be able to be grey, or Greyscale advertises
      // itself with a blue spot, and BLACK ringed in white, or Neutral and
      // High contrast — same hue, same tint, same accent — draw the same
      // dot. The lightness follows the primary's, the rule --primary-l
      // applies in index.css: grey near-black, colour mid-scale.
      dot: {
        color: `oklch(${(20.5 + 37.5 * accentTint) * (1 - contrast)}% ${0.135 * accentTint} ${accent})`,
        ring: `oklch(${90 + 10 * contrast}% ${0.006 * tint} ${hue})`,
      },
    };
  }),
}));

export function AppearanceCard() {
  const [moreOpen, setMoreOpen] = useState(false);
  const theme = useTheme((s) => s.preference);
  const setTheme = useTheme((s) => s.setPreference);
  const { boardTheme, pieces, schemeId, radius, density, castleStyle, coordinates, moveBox, reviewOffer, annotationSize, setBoardTheme, setPieces, setSchemeId, setRadius, setDensity, setCastleStyle, setCoordinates, setMoveBox, setReviewOffer, setAnnotationSize } =
    usePrefs();

  return (
    <Card icon={Palette} title={t('Appearance')}>
      {/* Language leads: it changes every other label on this page, so
          reading it first is what makes the rest of the card make sense. */}
      <Field label={APPEARANCE_LABELS.language}>
        <Select
          value={getLang()}
          onValueChange={(v) => setLang(v as Lang)}
          ariaLabel={t('App language')}
          groups={[{ options: LANGS.map((l) => ({ value: l.id, label: l.label })) }]}
        />
      </Field>

      <Field label={APPEARANCE_LABELS.theme}>
        <Select
          value={theme}
          onValueChange={(v) => setTheme(v as ThemePreference)}
          ariaLabel={t('App theme')}
          groups={[{ options: [
            { value: 'system', label: 'Follow system' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ] }]}
        />
      </Field>

      {/* Above the fold, and not with Corners: this is not how the app
          looks, it is how much of your vault is on the screen at once. On
          a page that is four hundred games it decides whether you read or
          scroll, which is a working setting and not a decorative one.
          Per-device, so the same vault is compact on a monitor and
          comfortable under a thumb. */}
      <Field label={APPEARANCE_LABELS.density}>
        <Select
          value={density}
          onValueChange={(v) => setDensity(v as Density)}
          ariaLabel={t('Density')}
          groups={[{ options: DENSITIES.map(({ id, label }) => ({ value: id, label })) }]}
        />
      </Field>

      {/* A dropdown like the rest of the card (lanph3re's call) — the row
          of swatches was the one control here that did not look like its
          neighbours. The list's headings stand in for the swatches' hint:
          shadcn's own five greys, the app's coloured ones, and the
          contrast one, each under its own label. */}
      <Field label={APPEARANCE_LABELS.colours}>
        <Select
          value={schemeId}
          onValueChange={setSchemeId}
          ariaLabel={t('Colours')}
          className="w-full"
          // Follow the board's dot is the board's own colour, which the
          // static list above cannot know; drawn from the chosen board.
          groups={SCHEME_GROUPS.map((g) => ({
            ...g,
            options: g.options.map((o) =>
              o.value === 'board'
                ? {
                    ...o,
                    dot: {
                      ...o.dot,
                      color: `oklch(${20.5 + 37.5 * boardScheme(boardTheme).accentTint!}% ${0.135 * boardScheme(boardTheme).accentTint!} ${boardScheme(boardTheme).accent})`,
                    },
                  }
                : o,
            ),
          }))}
        />
      </Field>

      {/* The swatch used to sit BESIDE the control, showing the theme
          already chosen — which is the one theme you can already see, on
          the board itself. What the list could not say was what the other
          nine look like: nine colour names, picked by reading. So the
          swatch moved onto the rows, one per preset, and the trigger wears
          the same one — the separate preview would now be the selected
          row's swatch drawn twice. */}
      <Field label={APPEARANCE_LABELS.board}>
        <Select
          value={boardTheme}
          onValueChange={(v) => setBoardTheme(v as BoardTheme)}
          ariaLabel={t('Board theme')}
          className="w-full"
          groups={[
            {
              options: BOARD_THEMES.map(({ id, label }) => ({
                value: id,
                label,
                thumb: <BoardPreview theme={id} />,
              })),
            },
          ]}
        />
      </Field>

      <Field label={APPEARANCE_LABELS.pieces}>
        <Select
          value={pieces}
          onValueChange={(v) => setPieces(v as PieceSet)}
          ariaLabel={t('Piece set')}
          className="w-full"
          groups={[
            {
              options: PIECE_SETS.map(({ id, label }) => ({
                value: id,
                label,
                thumb: <PiecePreview set={id} />,
              })),
            },
          ]}
        />
      </Field>

      <Field label={APPEARANCE_LABELS.castling}>
        <Select
          value={castleStyle}
          onValueChange={(v) => setCastleStyle(v as CastleStyle)}
          ariaLabel={t('How to castle')}
          groups={[{ options: CASTLE_STYLES.map(({ id, label }) => ({ value: id, label })) }]}
        />
      </Field>

      {/* Above the fold with the board it labels, not behind More options.
          It went in with Corners and Annotation size on the grounds that
          all three are decoration, and it is not: file and rank letters
          are how a position is READ, and whether they are there is a
          legibility choice somebody makes once and wants to find. */}
      <SettingRow
        title={t('Board coordinates')}
        blurb={t('File and rank labels on the board edge.')}
      >
        <Switch
          checked={coordinates}
          onCheckedChange={() => setCoordinates(!coordinates)}
          aria-label={t('Board coordinates')}
        />
      </SettingRow>

      {/* Beside coordinates rather than under More options for the same
          reason: it is a row that is on every moves panel or on none of
          them, and the keyboard's only way onto the board. */}
      <SettingRow
        title={t('Move box')}
        blurb={t('Play moves from the keyboard.')}
      >
        <Switch
          checked={moveBox}
          onCheckedChange={() => setMoveBox(!moveBox)}
          aria-label={t('Move box')}
        />
      </SettingRow>

      {/* The card was nine controls in one flat column, and a flat column
          says every row is worth the same glance. These two are not: they
          are how the app is DRAWN rather than what it draws. What stays
          above the fold is what a vault is set up with once — the language
          every other label on this page is in, the theme, the density, the
          colours, the board with its pieces and coordinates, and how a
          castle is entered.

          Nothing is removed and nothing is more than one press away. The
          fold is NOT remembered: a settings page that opens differently
          depending on what you did last time is a settings page you have
          to re-read before you can use it. */}
      <Disclosure label="More options" open={moreOpen} onToggle={() => setMoreOpen((v) => !v)}>
        <div className="flex flex-col gap-3">
          {/* shadcn's own second knob: every corner in the app is a multiple
              of one radius, so one number squares or rounds the whole thing. */}
          <Field label="Corners">
            <Select
              value={radius}
              onValueChange={(v) => setRadius(v as RadiusId)}
              ariaLabel={t('Corners')}
              className="w-full"
              groups={[{ options: RADIUS_PRESETS.map(({ id, label }) => ({ value: id, label })) }]}
            />
          </Field>

          {/* Appearance rather than Documents: it changes how one panel is
              drawn on THIS device, and nothing about the document — the same
              study read on a phone and a desktop is the same file either way.
              Named for the size rather than the subject, so it cannot be read
              as a switch for whether annotations show at all. */}
          <Field label="Annotation size">
            <Select
              value={annotationSize}
              onValueChange={(v) => setAnnotationSize(v as AnnotationSize)}
              ariaLabel={t('Annotation size')}
              groups={[{ options: ANNOTATION_SIZES.map(({ id, label }) => ({ value: id, label })) }]}
            />
          </Field>

          {/* Under the fold (lanph3re's call, 2026-09-18): it is set once,
              by someone the offer has started to bother, and is nothing a
              vault is set up with. */}
          <SettingRow
            title={t('Review offer')}
            blurb={t('Offer a review when a game opens.')}
          >
            <Switch
              checked={reviewOffer}
              onCheckedChange={() => setReviewOffer(!reviewOffer)}
              aria-label={t('Review offer')}
            />
          </SettingRow>
        </div>
      </Disclosure>
    </Card>
  );
}

/** A 2×2 checker in one named preset, for a row of the theme list.

    It declares `data-board` and then reads the plain board tokens, which
    is the whole trick: index.css defines every preset unanchored as well
    as on the root, so the attribute puts that preset's palette on this
    span and the swatch is painted by the same table the real board is.
    There is no palette here to drift from it.

    `--board-grain` is reset on the way in because only one preset defines
    it: on a page already wearing Wood, every OTHER swatch would inherit
    the grain from the root. The reset is on the outer span so Wood's own
    rule — which lands on the inner one, with the attribute — still wins. */
function BoardPreview({ theme }: { theme: BoardTheme }) {
  return (
    <span aria-hidden className="contents" style={{ '--board-grain': 'none' } as CSSProperties}>
      <span
        data-board={theme}
        className="border-border block size-5 shrink-0 rounded-sm border"
        style={{
          backgroundColor: 'var(--board-light)',
          // Same two layers as cg-board, so a textured theme is picked with
          // its texture visible. The swatch shows 4x4 squares, and the grain
          // is an 8x8 grid of cells, so it takes twice the swatch to put one
          // cell on one square — at 200% the top-left 4x4 of it shows.
          backgroundImage:
            'var(--board-grain, none), repeating-conic-gradient(var(--board-dark) 0% 25%, transparent 0% 50%)',
          backgroundSize: '200% 200%, 50% 50%',
          backgroundBlendMode: 'soft-light, normal',
        }}
      />
    </span>
  );
}

/** One knight of a set, standing on a square of the board in use.

    An <img> and not the board's own `piece` element, which is what every
    other picture of a piece in this app is. Those are painted by CSS keyed
    on an ANCESTOR's `data-pieces`, and this list wants ten sets at once
    under a page already wearing one of them: every row would match its own
    set's rule AND the page's, at the same specificity, and the winner
    would be whichever stylesheet chunk loaded last. So the art comes
    straight from `PIECE_THUMBS` — one knight per set, generated beside the
    stylesheets by scripts/setup-pieces.mjs — and the cascade never enters
    into it. It also means a row can show Fantasy without fetching the
    other eleven Fantasy pieces to do it.

    On a board square rather than on the popover, because that is the only
    background these are drawn to be legible on: white pieces are white,
    and the list is white in one app theme and near-black in the other. */
function PiecePreview({ set }: { set: PieceSet }) {
  return (
    <span
      aria-hidden
      className="border-border block size-5 shrink-0 overflow-hidden rounded-sm border"
      style={{ backgroundColor: 'var(--board-light)' }}
    >
      <img src={PIECE_THUMBS[set]} alt="" className="size-full" />
    </span>
  );
}
