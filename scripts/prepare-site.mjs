import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultSource = fileURLToPath(new URL('../dist', import.meta.url));
const releaseMarker = '<meta name="game-release" content="development">';
const bootstrapMarker = '<script type="module">import { boot } from \'./js/site-release.js\'; boot();</script>';

async function readTree(directory, prefix = '') {
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await readTree(join(directory, entry.name), path + '/'));
    else if (entry.isFile()) files.push([path, await readFile(join(directory, entry.name))]);
    else throw new Error(`Cannot package a link or special file: ${path}`);
  }
  return files;
}

/** Copy editable sources into one immutable release; never change dist itself. */
export async function prepareSite({ sourceDir = defaultSource, outputDir = resolve(sourceDir, '../.tmp/site') } = {}) {
  const source = await realpath(sourceDir);
  const output = resolve(outputDir);
  const expected = resolve(source, '../.tmp/site');
  if (output !== expected) throw new Error('Site output must be the source directory’s sibling .tmp/site directory.');
  if (output === source || output.startsWith(source + sep) || source.startsWith(output + sep)) {
    throw new Error('Site source and output cannot overlap.');
  }

  const files = await readTree(source);
  const inputs = new Map(files);
  const html = inputs.get('index.html')?.toString('utf8');
  const bootstrap = inputs.get('js/site-release.js')?.toString('utf8');
  if (!html || !bootstrap || html.split(releaseMarker).length !== 2 || html.split(bootstrapMarker).length !== 2) {
    throw new Error('The page must have exactly one development release marker and bootstrap script.');
  }
  if (/<\/script\s*>/i.test(bootstrap)) throw new Error('The bootstrap cannot contain a closing script tag.');

  const hash = createHash('sha256');
  for (const [path, bytes] of files) hash.update(path).update('\0').update(String(bytes.length)).update('\0').update(bytes).update('\0');
  const id = hash.digest('hex');
  const releasePath = `_releases/${id}`;

  // Restrict deletion to the checked staging directory, including on Windows
  // where a junction in .tmp or site could otherwise redirect it elsewhere.
  await mkdir(dirname(output), { recursive: true });
  if (await realpath(dirname(output)) !== dirname(output)) throw new Error('Site staging parent cannot be a symbolic link or junction.');
  const existing = await lstat(output).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink() || await realpath(output) !== output)) {
    throw new Error('Site staging output must be a real directory.');
  }
  await rm(output, { recursive: true, force: true });

  async function write(path, bytes) {
    const destination = join(output, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
  for (const [path, bytes] of files) {
    if (path === 'index.html') continue;
    if (path === 'manifest.webmanifest' || path.startsWith('assets/')) await write(path, bytes);
    if (path !== 'manifest.webmanifest') await write(`${releasePath}/${path}`, bytes);
  }
  await write('index.html', html
    .replace(releaseMarker, `<meta name="game-release" content="${id}">`)
    .replace(bootstrapMarker, () => `<script type="module">\n${bootstrap}\nboot();\n</script>`)
    .replace('href="./styles.css"', `href="./${releasePath}/styles.css"`)
    .replaceAll('href="./data/', `href="./${releasePath}/data/`));
  await write('release.json', JSON.stringify({ id }) + '\n');
  await write('.nojekyll', '');
  return { id, outputDir: output };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { id, outputDir } = await prepareSite();
  console.log(`Prepared release ${id} in ${outputDir}`);
}
