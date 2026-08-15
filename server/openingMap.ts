import { Hono } from 'hono';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeAtomic } from './atomic.ts';
import { VAULT } from './paths.ts';

/**
 * The opening map: the user's hand-placed tree of repertoire moves, with
 * studies and notes tagged onto its nodes.
 *
 * One map.json in vault/repertoire/, beside the drill history, because
 * they are two views of the same subject — what is prepared and how well.
 * Only the skeleton is stored: the prepared subtree beneath a node is
 * derived by the client from the tagged studies, never persisted, so the
 * map cannot drift from the studies it points at.
 *
 * Node identity is the SAN path from the start position, held as nested
 * children arrays; positions are replayed client-side. The server checks
 * shape and size only — it never parses move text, the same division of
 * labour the studies API keeps.
 */

type TagKind = 'study' | 'note' | 'game';

interface MapTag {
  kind: TagKind;
  /** Vault-relative document id, e.g. "Openings/Alapin". */
  id: string;
  /** Chapter name (studies only); covers its sub-chapters. */
  chapter?: string;
}

interface MapNode {
  id: string;
  /** Absent on a root node, exactly one move everywhere else. */
  san?: string;
  name?: string;
  note?: string;
  /** Intended preparation depth, in full moves. */
  depth?: number;
  tags?: MapTag[];
  children: MapNode[];
}

interface OpeningMap {
  id: string;
  color: 'white' | 'black';
  name?: string;
  root: MapNode;
}

interface MapDoc {
  version: 1;
  maps: OpeningMap[];
}

const TAG_KINDS = new Set<TagKind>(['study', 'note', 'game']);
const MAX_NODES = 5000;
const MAX_BYTES = 1_000_000;

const isShortString = (v: unknown, cap: number): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= cap;

const validTag = (t: unknown): t is MapTag => {
  if (typeof t !== 'object' || t === null) return false;
  const tag = t as Partial<MapTag>;
  return (
    TAG_KINDS.has(tag.kind as TagKind) &&
    isShortString(tag.id, 512) &&
    (tag.chapter === undefined || isShortString(tag.chapter, 200))
  );
};

/** Walks a node subtree, returning its node count, or -1 on any bad shape. */
const countValidNodes = (n: unknown, isRoot: boolean): number => {
  if (typeof n !== 'object' || n === null) return -1;
  const node = n as Partial<MapNode>;
  if (!isShortString(node.id, 32)) return -1;
  if (isRoot ? node.san !== undefined : !isShortString(node.san, 12)) return -1;
  if (node.name !== undefined && !isShortString(node.name, 200)) return -1;
  if (node.note !== undefined && (typeof node.note !== 'string' || node.note.length > 2000))
    return -1;
  if (node.depth !== undefined && (typeof node.depth !== 'number' || !Number.isFinite(node.depth)))
    return -1;
  if (node.tags !== undefined && !(Array.isArray(node.tags) && node.tags.every(validTag)))
    return -1;
  if (!Array.isArray(node.children)) return -1;
  let count = 1;
  for (const child of node.children) {
    const sub = countValidNodes(child, false);
    if (sub < 0) return -1;
    count += sub;
  }
  return count;
};

const validDoc = (doc: unknown): doc is MapDoc => {
  if (typeof doc !== 'object' || doc === null) return false;
  const d = doc as Partial<MapDoc>;
  if (d.version !== 1 || !Array.isArray(d.maps)) return false;
  let nodes = 0;
  for (const m of d.maps) {
    const map = m as Partial<OpeningMap>;
    if (typeof map !== 'object' || map === null) return false;
    if (!isShortString(map.id, 32)) return false;
    if (map.color !== 'white' && map.color !== 'black') return false;
    if (map.name !== undefined && !isShortString(map.name, 200)) return false;
    const sub = countValidNodes(map.root, true);
    if (sub < 0) return false;
    nodes += sub;
  }
  return nodes <= MAX_NODES;
};

/**
 * Follow a document rename through the map's tags.
 *
 * Tag ids are vault paths, and paths change; the bookmarks' remark()
 * already follows renames for the same reason. Deletions are NOT
 * followed: a tag whose study vanished is information — "this line lost
 * its prep" — and the panel shows it as a broken reference instead. A
 * missing or unreadable map is a no-op; this runs as a side effect of a
 * rename that already succeeded and must never fail it.
 */
export function remapMapTags(
  stateDir: string,
  kind: TagKind,
  change: { from: string; to: string; folder?: boolean },
): void {
  const mapPath = resolve(stateDir, 'map.json');
  let doc: MapDoc;
  try {
    doc = JSON.parse(readFileSync(mapPath, 'utf-8')) as MapDoc;
  } catch {
    return;
  }
  if (!Array.isArray(doc?.maps)) return;
  let changed = false;
  const renamed = (id: string): string => {
    if (!change.folder) return id === change.from ? change.to : id;
    return id.startsWith(`${change.from}/`) ? `${change.to}${id.slice(change.from.length)}` : id;
  };
  const walk = (node: MapNode): void => {
    for (const tag of node.tags ?? []) {
      if (tag.kind !== kind) continue;
      const to = renamed(tag.id);
      if (to !== tag.id) {
        tag.id = to;
        changed = true;
      }
    }
    for (const child of node.children ?? []) walk(child);
  };
  for (const map of doc.maps) if (map?.root) walk(map.root);
  if (changed) writeAtomic(mapPath, `${JSON.stringify(doc, null, 2)}\n`);
}

export function openingMapApi(stateDir: string = resolve(VAULT, 'repertoire')): Hono {
  const mapPath = resolve(stateDir, 'map.json');

  const api = new Hono();

  api.get('/openingmap', (c) => {
    let raw: string;
    try {
      raw = readFileSync(mapPath, 'utf-8');
    } catch {
      return c.json({ version: 1, maps: [] });
    }
    // A damaged file is a 500, never an empty fallback: the client would
    // save over it and turn transient damage into permanent loss.
    try {
      return c.json(JSON.parse(raw) as MapDoc);
    } catch {
      return c.json({ error: 'map.json is damaged; fix or remove it' }, 500);
    }
  });

  api.put('/openingmap', async (c) => {
    const body = (await c.req.json().catch(() => null)) as unknown;
    if (!validDoc(body)) return c.json({ error: 'not a valid opening map document' }, 400);
    const text = JSON.stringify(body, null, 2);
    if (text.length > MAX_BYTES) return c.json({ error: 'map too large' }, 400);
    mkdirSync(stateDir, { recursive: true });
    writeAtomic(mapPath, `${text}\n`);
    return c.json({ ok: true });
  });

  return api;
}
