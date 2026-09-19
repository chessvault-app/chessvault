import { t } from '@/lib/i18n';

/**
 * What each Insights card prints over its body, whatever the report says.
 *
 * The page prints these and the outline (InsightsPage.skeleton) lays the
 * same words out invisibly to size each header, so a sentence reworded in
 * one file and not the other mis-sizes a card with nothing to say so. The
 * demo serves no report, which means no browser check reaches this page
 * either: one statement of the words is the only guard it has.
 *
 * Functions rather than strings, so each stays a `t('literal')` that
 * `check:repo` can hold to its Korean entry.
 */
export const INSIGHTS_COPY = {
  results: {
    title: () => t('Results'),
    desc: () => t('Score is wins plus half the draws, out of the games played.'),
  },
  quality: {
    title: () => t('Move quality'),
    desc: () =>
      t("Every move you played in the analysed games, by the engine's verdict, and how accurate they were by phase and by move number."),
  },
  openings: {
    title: () => t('Openings'),
    desc: () =>
      t('One row per opening family, named from the deepest catalogued position each game reached. Most played first.'),
  },
  book: {
    title: () => t('Leaving book'),
    desc: () =>
      t('The first move after which the position is in no catalogued line, and whose move it was. The openings where your own move leaves earliest come first.'),
  },
  compare: {
    title: () => t('Compare with a database'),
    desc: (color: 'white' | 'black') =>
      color === 'white'
        ? t('Your recent games as White, checked against this database’s players. Positions where your move is one they rarely choose, strongest habit first.')
        : t('Your recent games as Black, checked against this database’s players. Positions where your move is one they rarely choose, strongest habit first.'),
  },
  activity: {
    title: () => t('Activity'),
    desc: () => t('Games per month, won over drew over lost, and the week.'),
  },
  endings: {
    title: () => t('How games ended'),
    desc: () =>
      t("Read from the move text and the file's own termination line. A decisive game that names neither is counted as a resignation."),
  },
  length: {
    title: () => t('Game length'),
    desc: () => t('Results by how many moves the game ran.'),
  },
} as const;
