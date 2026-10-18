import { writeFile } from 'node:fs/promises';

// Deployment-only configuration. The public API URL is not an account secret.
const value = (process.env.BATTLE_API_URL || '').trim();
if (value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('BATTLE_API_URL must be an HTTPS origin, such as https://battle-words-api.example.workers.dev');
  }
  await writeFile(new URL('../dist/js/battle-config.js', import.meta.url),
    `// Public battle service URL, supplied by deployment configuration.\nexport const BATTLE_API_URL = ${JSON.stringify(url.origin)};\n`);
  console.log('Configured the public battle service URL.');
} else {
  console.log('No BATTLE_API_URL supplied; keeping the checked-in frontend configuration.');
}
