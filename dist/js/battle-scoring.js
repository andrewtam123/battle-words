/** Derive totals from resolved rounds, including matches saved before ties earned points. */
export function battleScores(results) {
  const scores = [0, 0];
  for (const result of results) {
    if (result.outcome === 'tie') {
      scores[0] += 0.5;
      scores[1] += 0.5;
    } else if (result.outcome === 'win' && (result.winner === 0 || result.winner === 1)) {
      scores[result.winner] += 1;
    }
  }
  return scores;
}
