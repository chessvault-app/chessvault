/** Position identity: the FEN without its move counters, so a
    transposition lands on one entry. Born in the drill, but every feature
    that keys anything by position uses it — so it lives here, not in
    repertoire/. */
export const fenKey = (fen: string): string => fen.split(' ').slice(0, 4).join(' ');
