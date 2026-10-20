/** Battle outcome copy; shared puzzle and entry rules live in game-core.js. */
export function roundFeedback(result, seat, submittedWord) {
  if (!result) return { appearance: '', text: '' };
  if (result.outcome === 'tie') return { appearance: 'tie', text: 'A tie! Both found it.' };
  if (result.outcome === 'timeout') return { appearance: 'unclaimed', text: 'Neither player found it.' };
  if (result.winner === seat) return { appearance: 'correct', text: 'Found it! You win this round.' };
  if (submittedWord) return { appearance: 'lost', text: 'Almost!' };
  return { appearance: 'lost', text: 'Your opponent found it.' };
}

/** Public review copy has the same meaning for players and spectators. */
export function roundReviewStatus(result, players) {
  if (result.outcome === 'timeout') return { appearance: 'unclaimed', text: '× Missed' };
  const tied = result.outcome === 'tie';
  const elapsedMs = tied ? Math.min(...result.elapsedMs) : result.elapsedMs[result.winner];
  const time = `(${(elapsedMs / 1000).toFixed(1)}s)`;
  return {
    appearance: tied ? 'tied' : 'solved',
    text: tied ? `= Tied ${time}` : `✓ ${players[result.winner].name} ${time}`,
  };
}
