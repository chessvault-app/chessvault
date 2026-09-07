import { Fragment } from 'react';

/**
 * A sentence with a number in it, the number in the mono role and the
 * words in the UI face.
 *
 * "30 games" was one `font-mono` span, so the digits were JetBrains Mono
 * and the word beside them too; in Korean the same span read "게임 30개",
 * and JetBrains Mono has no hangul, so the two words fell through to
 * Pretendard inside a mono span: two typefaces in one word. The mono
 * role is for what is scanned as a column or copied as a literal
 * (design-principles, the type scale); a count's noun is neither. So the
 * figure alone takes the role, in tabular figures so a column of them
 * still lines up, and the words stay in the sentence's own face.
 */
export function Figures({ text }: { text: string }) {
  // A run of digits with its own punctuation: "1,234", "3.5", "2:30", "40%".
  const parts = text.split(/(\d[\d,.:%]*)/);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="font-mono tabular-nums">
            {part}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
