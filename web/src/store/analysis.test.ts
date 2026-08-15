import { beforeEach, describe, expect, it } from 'vitest';
import { getNode, INITIAL_FEN } from '@shared/tree';
import { useAnalysis } from './analysis';

/**
 * Clearing the moves is the study's only clear — a chapter's starting
 * position, its introduction and the game around it have to survive it, or
 * the act quietly destroys the document it was meant to empty.
 */
describe('clearMoves', () => {
  // A position that is NOT the standard start, so a reset would be
  // distinguishable from a clear.
  const FEN = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 4 4';

  beforeEach(() => {
    useAnalysis.getState().reset(FEN);
  });

  it('drops every move and leaves the position they started from', () => {
    const store = useAnalysis.getState();
    expect(store.playSan('Bc5')).toBe(true);
    expect(useAnalysis.getState().playSan('c3')).toBe(true);
    // A second line off the root, so the clear has more than one subtree.
    useAnalysis.setState({ cursorId: useAnalysis.getState().tree.rootId });
    expect(useAnalysis.getState().playSan('Nf6')).toBe(true);

    useAnalysis.getState().clearMoves();

    const { tree, cursorId } = useAnalysis.getState();
    expect(getNode(tree, tree.rootId).children).toEqual([]);
    expect(cursorId).toBe(tree.rootId);
    expect(getNode(tree, tree.rootId).fen).toBe(FEN);
    // Only the root is left — the doomed nodes went with their subtrees.
    expect(Object.keys(tree.nodes)).toEqual([tree.rootId]);
  });

  it('keeps the chapter introduction and the game around it', () => {
    useAnalysis.setState({ gameHeaders: { White: 'Someone', Black: 'Else' }, orientation: 'black' });
    const rootId = useAnalysis.getState().tree.rootId;
    useAnalysis.getState().setComment(rootId, 'How this chapter starts');
    useAnalysis.getState().playSan('Bc5');

    useAnalysis.getState().clearMoves();

    const state = useAnalysis.getState();
    expect(getNode(state.tree, state.tree.rootId).comment).toBe('How this chapter starts');
    expect(state.gameHeaders).toEqual({ White: 'Someone', Black: 'Else' });
    expect(state.orientation).toBe('black');
  });

  it('is a no-op with nothing to clear', () => {
    const before = useAnalysis.getState().tree;
    useAnalysis.getState().clearMoves();
    expect(useAnalysis.getState().tree).toBe(before);
  });

  it('is what reset is not: reset goes back to the standard position', () => {
    useAnalysis.getState().playSan('Bc5');
    useAnalysis.getState().reset();
    const { tree } = useAnalysis.getState();
    expect(getNode(tree, tree.rootId).fen).toBe(INITIAL_FEN);
  });
});

/**
 * Walking an engine line in one step. The whole reason it is not playUci in
 * a loop is that each publish re-analyses the new position, so the count of
 * state changes matters as much as where the cursor ends up.
 */
describe('playLine', () => {
  beforeEach(() => {
    useAnalysis.getState().reset();
  });

  it('adds a node per ply and lands the cursor on the last one', () => {
    expect(useAnalysis.getState().playLine(['e2e4', 'e7e5', 'g1f3'])).toBe(true);

    const { tree, cursorId } = useAnalysis.getState();
    expect(getNode(tree, cursorId).san).toBe('Nf3');
    expect(getNode(tree, cursorId).ply).toBe(3);
    expect(Object.keys(tree.nodes)).toHaveLength(4); // root + three plies
  });

  it('publishes the whole walk once, however long the line', () => {
    let publishes = 0;
    const stop = useAnalysis.subscribe(() => {
      publishes += 1;
    });
    useAnalysis.getState().playLine(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5']);
    stop();

    expect(publishes).toBe(1);
  });

  it('reuses the line it already walked instead of branching beside it', () => {
    useAnalysis.getState().playLine(['e2e4', 'e7e5', 'g1f3']);
    const after3 = Object.keys(useAnalysis.getState().tree.nodes).length;

    // Back to the start and down the same line, two plies further.
    useAnalysis.setState({ cursorId: useAnalysis.getState().tree.rootId });
    expect(useAnalysis.getState().playLine(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5'])).toBe(true);

    const { tree, cursorId } = useAnalysis.getState();
    expect(Object.keys(tree.nodes)).toHaveLength(after3 + 2);
    expect(getNode(tree, cursorId).san).toBe('Bb5');
    // One move out of the root, not two identical ones.
    expect(getNode(tree, tree.rootId).children).toHaveLength(1);
  });

  it('stops at a move that will not play and keeps what came before', () => {
    expect(useAnalysis.getState().playLine(['e2e4', 'e7e5', 'e2e4', 'g1f3'])).toBe(true);

    const { tree, cursorId } = useAnalysis.getState();
    expect(getNode(tree, cursorId).san).toBe('e5');
    expect(Object.keys(tree.nodes)).toHaveLength(3);
  });

  it('changes nothing at all when no ply applies', () => {
    const before = useAnalysis.getState().tree;
    expect(useAnalysis.getState().playLine([])).toBe(false);
    expect(useAnalysis.getState().playLine(['e7e5'])).toBe(false);
    // The same object, not merely an equal one: nothing was published.
    expect(useAnalysis.getState().tree).toBe(before);
  });
});
