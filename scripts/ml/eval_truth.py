"""Hand-labeled ground truth for the 11 real-book evaluation boards
(data/ml/eval-11/t{n}.board.gray). NEVER train on these. Transcribed and
double-checked from '1001 Chess Exercises for Beginners' crops.
"""

# Piece-placement FENs, board images already aligned to 512x512, a8 top-left.
TRUTH = {
    0: 'kr6/1p6/p7/4b3/8/8/1P4BP/R6K',
    1: '8/3R4/1k6/1pN5/4b3/1N3q2/5P1P/3R2K1',
    2: '6r1/1b3pnk/1p6/p1pqP2P/P7/R7/1P3PP1/2B3K1',
    3: 'r1b2r2/5P1p/ppn3pk/2p1p1Nq/1bP1PQ2/3P4/PB4BP/1R3RK1',
    4: '4k3/3pPpK1/3P1Pb1/8/8/8/B7/8',
    5: '8/7P/4b1p1/2pp4/1p1k4/1P2p3/4K3/6q1',
    6: '2r2r1k/6pp/2NN4/5p2/2Q2nq1/8/6PP/2R4K',
    7: '8/3bk1q1/1p2p3/2p2p1p/1p6/1P5P/5PP1/R2R2K1',
    8: '2r4r/3Q1bk1/pq4p1/5R2/2p5/2P2P2/PP5P/6RK',
    9: 'r4r2/pp1R3p/5pk1/2p2p2/2P2P2/1P6/P7/3R3K',
    10: '5k2/1p6/2p1BP2/p3P1P1/6p1/P5r1/3K4/4r3',
}

FEN_CHARS = '1RNBQKPrnbqkp'  # class order, kept identical to linrock's


def expand(fen: str) -> list:
    out = []
    for rank in fen.split('/'):
        for ch in rank:
            out.extend(['1'] * int(ch)) if ch.isdigit() else out.append(ch)
    assert len(out) == 64, fen
    return out
