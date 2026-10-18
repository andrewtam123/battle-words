/** Battle outcome copy; shared puzzle and entry rules live in game-core.js. */
export function roundFeedback(result, seat, submittedWord) {
  if (!result) return { appearance: '', text: '' };
  if (result.outcome === 'tie') return { appearance: 'tie', text: 'A tie! Both found it.' };
  if (result.winner === seat) return { appearance: 'correct', text: 'Found it! You win this round.' };
  if (submittedWord) return { appearance: 'lost', text: 'Almost!' };
  return result.outcome === 'timeout'
    ? { appearance: 'timeout', text: 'Time’s up.' }
    : { appearance: 'lost', text: 'Your opponent found it.' };
}
