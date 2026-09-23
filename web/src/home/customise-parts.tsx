import { ChevronDown, ChevronUp, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingRow } from '@/components/setting-row';
import { Switch } from '@/components/ui/switch';
import { t } from '@/lib/i18n';
import { HOME_DESTINATIONS, type Destination } from './destinations';
import { HOME_CARDS, cardOn, resolveHomeLayout, type HomeLayout } from './layout';

/**
 * Everything the customise window draws under its title, leaving
 * CustomiseDialog itself the sheet's wiring.
 *
 * This body used to be drawn twice. The window was lazy, and the
 * stand-in shown while its chunk was on the wire rendered this same
 * component held inert - the placeholder that cannot disagree with what
 * replaces it, which was the right instinct aimed at a wait that was not
 * worth covering. The chunk was 1.8 kB of glue over machinery the
 * landing chunk already carried, and the swap rebuilt these ~40 rows
 * from nothing in the middle of the sheet's entrance. The window is
 * eager now and this mounts once (HomePage says what that measured).
 */
export function CustomiseBody({
  layout,
  onToggleCard,
  onPromote,
  onDemote,
  onHide,
  onUnhide,
  onMove,
  onReset,
}: {
  layout: HomeLayout;
  onToggleCard: (id: string) => void;
  onPromote: (entry: Destination) => void;
  onDemote: (entry: Destination) => void;
  onHide: (entry: Destination) => void;
  onUnhide: (entry: Destination) => void;
  onMove: (entry: Destination, from: number, by: -1 | 1) => void;
  onReset: () => void;
}) {
  const { tiles, launchers, hidden } = resolveHomeLayout(layout, HOME_DESTINATIONS);
  return (
    <>
      <p className="text-muted-foreground text-sm leading-relaxed">
        {/* Names the phone's way to everything as well as the desktop's:
            the sheet opens from a grid drawn only below md, where there
            is no sidebar to be told about. */}
        {/* In the controls' own words: the switch, the "Hide" button
            and the groups "In the row below" and "Off the page". It
            said "Off" and "Hidden", states no control was labelled with. */}
        {t('Switch a card off to take it off the page. Switch a destination off to move it to the row below. Hide takes it off the page. The sidebar and the More tab still reach everything.')}
      </p>

      {/* Every card the page can draw, on or off. A card the phone never
          shows says so in its blurb, so the switch does not read as one
          that does nothing. */}
      <Group label={t('Cards')} empty="" count={HOME_CARDS.length}>
        {HOME_CARDS.map((card) => (
          <SettingRow
            key={card.id}
            title={t(card.label)}
            blurb={card.phone ? t(card.blurb) : `${t(card.blurb)} ${t('Wide screens only.')}`}
          >
            <Switch
              checked={cardOn(layout, card.id)}
              onCheckedChange={() => onToggleCard(card.id)}
              aria-label={t(card.label)}
            />
          </SettingRow>
        ))}
      </Group>

      {/* No scroller of its own. Sheet's body already scrolls, so capping
          this at max-h-72 made a second one inside the first, which held
          the card switches and the paragraph above them permanently on
          screen while only the destinations moved. Nothing here is worth
          pinning: a short list in a tall sheet was scrolling in a box
          while the sheet around it had room to spare. */}
      <div className="flex flex-col gap-1">
        <Group label={t('On the grid')} empty={t('Nothing. Every destination is a button below.')} count={tiles.length}>
          {tiles.map((entry, i) => (
            // Keyed by id, not position: React then MOVES the row that
            // moved, and the focus ring travels with it. Keyed by index,
            // a second press would reorder the row that took its place.
            <Row key={entry.id} entry={entry} checked onToggle={() => onDemote(entry)}>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={i === 0}
                title={t('Move up')}
                aria-label={t('Move {name} up', { name: t(entry.label) })}
                onClick={() => onMove(entry, i, -1)}
              >
                <ChevronUp className="glyph" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={i === tiles.length - 1}
                title={t('Move down')}
                aria-label={t('Move {name} down', { name: t(entry.label) })}
                onClick={() => onMove(entry, i, 1)}
              >
                <ChevronDown className="glyph" />
              </Button>
              <HideButton entry={entry} onHide={() => onHide(entry)} />
            </Row>
          ))}
        </Group>

        <Group label={t('In the row below')} empty={t('Nothing. Every destination is a tile.')} count={launchers.length}>
          {launchers.map((entry) => (
            <Row key={entry.id} entry={entry} checked={false} onToggle={() => onPromote(entry)}>
              <HideButton entry={entry} onHide={() => onHide(entry)} />
            </Row>
          ))}
        </Group>

        <Group
          label={t('Off the page')}
          empty={t('Nothing. Every destination is on home.')}
          count={hidden.length}
        >
          {hidden.map((entry) => (
            // No switch: a switch offers two states, and this row is in
            // neither of them. One button, and it says where it goes.
            <Row key={entry.id} entry={entry}>
              <Button
                variant="ghost"
                size="icon-sm"
                title={t('Bring back')}
                aria-label={t('Bring {name} back', { name: t(entry.label) })}
                onClick={() => onUnhide(entry)}
              >
                <Eye className="glyph" />
              </Button>
            </Row>
          ))}
        </Group>
      </div>

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={onReset}>
          {t('Reset to default')}
        </Button>
      </div>
    </>
  );
}

function Group({
  label,
  empty,
  count,
  children,
}: {
  label: string;
  empty: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1" role="group" aria-label={label}>
      <p className="text-muted-foreground px-1 pt-1 type-row font-medium">
        {label}
      </p>
      {/* A group that has emptied says so. A heading over nothing reads as
          a page that failed to draw. */}
      {count === 0 ? <p className="text-muted-foreground px-1 pb-1 text-sm">{empty}</p> : children}
    </div>
  );
}

/** Shared by all three groups; the hidden ones pass no toggle. */
function HideButton({ entry, onHide }: { entry: Destination; onHide: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      title={t('Hide')}
      aria-label={t('Hide {name}', { name: t(entry.label) })}
      onClick={onHide}
    >
      <EyeOff className="glyph" />
    </Button>
  );
}

function Row({
  entry,
  checked,
  onToggle,
  children,
}: {
  entry: Destination;
  checked?: boolean;
  /** Omitted for a row that is on neither the grid nor the row below. */
  onToggle?: () => void;
  children?: React.ReactNode;
}) {
  const { icon: Icon, label } = entry;
  return (
    // px-3, not px-2, and the 3 is a measurement rather than a taste: on a
    // coarse pointer `Switch` grows its touch target with an absolutely
    // positioned ::before inset by -12px, which is invisible but still
    // counts towards scrollable overflow. Against 8px of padding it stood
    // 4px outside the row, which made the list, a scroll container in
    // both axes as `overflow-y-auto` always is, pannable sideways by 3px
    // on a phone, with no scrollbar to say why. 12px of padding contains
    // it exactly, so the whole touch target survives.
    <div className="border-card-ring bg-muted flex items-center gap-2 rounded-md border px-3 py-(--row-py-dense)">
      <Icon className="text-muted-foreground glyph shrink-0" />
      <span className="min-w-0 flex-1 truncate type-row">{t(label)}</span>
      {children}
      {onToggle && <Switch checked={checked ?? false} onCheckedChange={onToggle} aria-label={t(label)} />}
    </div>
  );
}
