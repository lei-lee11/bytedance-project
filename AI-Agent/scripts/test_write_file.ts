import fs from 'fs/promises';
import path from 'path';

async function resolveProjectPath(inputPath: string, projectRoot: string) {
  const base = path.resolve(projectRoot);
  const raw = inputPath.trim();
  const candidate = path.isAbsolute(raw) ? path.normalize(raw) : path.normalize(path.join(base, raw));
  const rel = path.relative(base, candidate);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Illegal path outside projectRoot: "${inputPath}" -> ${candidate}`);
  }
  return candidate;
}

async function run() {
  const projectRoot = process.cwd();
  console.log('Using projectRoot:', projectRoot);

  const filePath = 'src/types/post.ts';
  const content = 'export type Post = { id: string; title: string; body: string; }';
  const createDirectories = true;

  try {
    const resolved = await resolveProjectPath(filePath, projectRoot);
    console.log('Resolved path:', resolved);

    const dir = path.dirname(resolved);
    if (createDirectories) {
      await fs.mkdir(dir, { recursive: true });
    } else {
      try {
        await fs.access(dir);
      } catch (e) {
        throw new Error(`Directory does not exist: ${dir}`);
      }
    }

    await fs.writeFile(resolved, content, 'utf8');

    const verify = await fs.readFile(resolved, 'utf8');
    if (verify !== content) {
      throw new Error('Content verification failed');
    }

    console.log('Write successful:', resolved);
  } catch (err) {
    console.error('Write failed:', err);
  }
}

run().catch((e) => console.error(e));
