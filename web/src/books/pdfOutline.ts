import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useEffect, useState } from 'react';

/**
 * A book's own table of contents, where the PDF carries one.
 *
 * pdf.js returns the outline as a tree of entries whose destination is
 * either a named destination (a string, looked up once) or an explicit
 * one (an array whose first element is a page reference). Both end in a
 * page reference, and the reference resolves to a page index. Entries
 * whose destination cannot be resolved are dropped: a chapter that leads
 * nowhere is not a chapter the reader can turn to.
 *
 * The tree is flattened for the list, each entry keeping its depth so
 * sub-chapters can sit indented under theirs. A scanned book with no
 * outline, or one whose outline is empty, resolves to an empty list and
 * the reader shows no contents control at all.
 */
export interface Chapter {
  title: string;
  page: number;
  /** 0 for a top-level entry, 1 for its children, and so on. */
  depth: number;
}

type OutlineNode = Awaited<ReturnType<PDFDocumentProxy['getOutline']>>[number];

async function pageOf(doc: PDFDocumentProxy, dest: OutlineNode['dest']): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    const ref: unknown = explicit?.[0];
    if (!ref || typeof ref !== 'object') return null;
    return (await doc.getPageIndex(ref as Parameters<PDFDocumentProxy['getPageIndex']>[0])) + 1;
  } catch {
    return null;
  }
}

export async function readOutline(doc: PDFDocumentProxy): Promise<Chapter[]> {
  const outline = await doc.getOutline();
  if (!outline || outline.length === 0) return [];
  const out: Chapter[] = [];
  const walk = async (nodes: OutlineNode[], depth: number): Promise<void> => {
    for (const node of nodes) {
      const title = node.title.trim();
      const page = title ? await pageOf(doc, node.dest) : null;
      // A heading that resolves nowhere still keeps its children's place
      // in the tree: their depth is counted from it, not from the top.
      if (page !== null) out.push({ title, page, depth });
      if (node.items?.length) await walk(node.items, depth + 1);
    }
  };
  await walk(outline, 0);
  return out;
}

/** The open document's chapters; empty until read, and empty for a book without any. */
export function usePdfOutline(doc: PDFDocumentProxy | null): Chapter[] {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  useEffect(() => {
    setChapters([]);
    if (!doc) return;
    let live = true;
    void readOutline(doc)
      .then((list) => {
        if (live) setChapters(list);
      })
      .catch(() => {
        // An outline that cannot be read is a book without one.
      });
    return () => {
      live = false;
    };
  }, [doc]);
  return chapters;
}

/**
 * The chapter the reader is in, or -1 before the first.
 */
export function chapterAt(chapters: Chapter[], page: number): number {
  // The nearest start at or before the page; on a tie the later entry,
  // which is the deeper heading printed on that page. Not a break on the
  // first later page: an outline is usually in page order, but nothing
  // guarantees it.
  let at = -1;
  for (let i = 0; i < chapters.length; i++) {
    const p = chapters[i]!.page;
    if (p <= page && (at < 0 || p >= chapters[at]!.page)) at = i;
  }
  return at;
}
