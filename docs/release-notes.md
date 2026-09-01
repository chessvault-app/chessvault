# Writing a release's notes

*English · [한국어](release-notes.ko.md)*

The body of a GitHub release. It is not written from nothing and it is
never left empty: it is that version's entry in
[the update log](update-log.md), tightened for somebody who has not been
reading the commits.

`scripts/release.sh` tags and pushes; GitHub builds the installers onto a
DRAFT. The notes go into that draft, and the draft is published LAST —
electron-builder silently skips a release that is already published, and
0.4.9 shipped with zero assets that way. The script's `--publish` does the
waiting, the asset check and the publish in the one safe order.

## The shape

Four parts, always in this order.

**The lede.** Three to five lines, no heading, before anything else. It is
the version heading's own lede from the update log — the two or three
things a reader would notice first, in one sentence each. If the update
log's heading has no lede yet, the release is being cut before that
heading was settled; settle it there first, so both files say the same
thing.

**The stories,** each under a `###` heading in sentence case. One heading
per *story*, not one per log entry: entries that are the same story get
one section between them. Each section says what was wrong, what it is
now, and the number that was measured — in that order, because the number
means nothing until the reader knows what it is a number about.

**`### Also`,** last of the sections, for the small ones that do not earn
a heading. Skip it when there are none.

**The footer**: a `---` rule, then one line pointing at the whole list.

```markdown
---

Nine entries in all — the full list, in English and Korean, is in
[docs/update-log.md](https://github.com/chessvault-app/chessvault/blob/v0.7.2/docs/update-log.md).
```

The link points at **the tag**, never at `main`, so it keeps saying what
the release said after the log has moved on. The count is the entries in
that version's heading, so a reader who wonders what the sections left out
can tell there is a rest and where it is.

## What survives the tightening, and what does not

The update log is written for whoever maintains this app. A release note
is read by whoever installs it. So:

- **Keep every number that names something the reader can see.** "the
  search box moved 347px", "the wrong tab was up for about 85ms", "1.26:1
  against the page". These are the whole reason to trust the entry.
- **Drop the numbers only an implementer can use.** A flick threshold in
  px/ms, a React render count, the name of the token that moved. They are
  in the log, which is where somebody looking for them will be.
- **Drop the reasoning about alternatives** — what was tried first, why
  the other shape was rejected. The log keeps that; a release note states
  what happened.
- **Keep the honest halves.** A cost, a limitation, a thing that is still
  wrong belongs in the note exactly as it belongs in the log. A release
  note that only contains good news is marketing, which this project's
  voice does not do.
- **Never introduce a claim the log does not make.** If it is worth
  saying and is not in the log, the log is missing an entry.

Quoting a UI string uses the same rule as the manual: curly double quotes
mean the screen says this. Difficulty stays a word; nothing here exposes a
rating.

## The skeleton

```markdown
<the update log heading's lede, three to five lines, no heading>

### <A story, in sentence case>

<What was wrong, and why it was wrong — a paragraph.>

<What it is now, and the measurement.>

### <The next story>

…

### Also

<The small ones, a sentence or two each.>

---

<N> entries in all — the full list, in English and Korean, is in
[docs/update-log.md](https://github.com/chessvault-app/chessvault/blob/<tag>/docs/update-log.md).
```

## Putting it in

Write the body into the draft after the desktop build has filled it, and
check the assets are really there before publishing — the three
`latest*.yml` updater manifests are the ones an installed app reads:

```bash
gh release view v0.0.0 --json assets -q '[.assets[].name] | join(" ")'
gh release edit v0.0.0 --notes-file <your-notes.md>
gh release edit v0.0.0 --draft=false        # last, and only after the above
```
