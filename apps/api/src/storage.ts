import { chmod, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export type StoredOriginal = {
  objectPath: string;
  remove: () => Promise<void>;
};

function resolveObjectPath(root: string, objectPath: string): string {
  if (isAbsolute(objectPath) || objectPath.split(/[\\/]/).some((part) => part === '..' || part === '.')) {
    throw new Error('Invalid stored object reference.');
  }
  const fullPath = resolve(root, objectPath);
  const fromRoot = relative(resolve(root), fullPath);
  if (!fromRoot || fromRoot.startsWith(`..${sep}`) || fromRoot === '..' || isAbsolute(fromRoot)) {
    throw new Error('Stored object is outside the configured root.');
  }
  return fullPath;
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function writeOriginal(
  root: string,
  tenantId: string,
  caseId: string,
  evidenceId: string,
  bytes: Buffer,
): Promise<StoredOriginal> {
  if (!isAbsolute(root)) {
    throw new Error('Storage root must be an absolute path.');
  }
  const objectPath = join(tenantId, caseId, `${evidenceId}.txt`);
  const rootPath = resolve(root);
  const fullPath = resolveObjectPath(rootPath, objectPath);
  const directory = dirname(fullPath);
  const tenantDirectory = dirname(directory);
  await mkdir(root, {recursive: true, mode: 0o700});
  await chmod(rootPath, 0o700);
  await mkdir(directory, {recursive: true, mode: 0o700});
  await chmod(tenantDirectory, 0o700);
  await chmod(directory, 0o700);
  await syncDirectory(dirname(rootPath));
  await syncDirectory(rootPath);
  await syncDirectory(tenantDirectory);

  let created = false;
  try {
    const handle = await open(fullPath, 'wx', 0o600);
    created = true;
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await syncDirectory(directory);
  } catch (error) {
    if (created) {
      await unlink(fullPath).catch(() => undefined);
    }
    throw error;
  }

  return {
    objectPath,
    remove: async () => {
      await unlink(fullPath).catch(() => undefined);
      await syncDirectory(directory).catch(() => undefined);
    },
  };
}

export async function readOriginal(root: string, objectPath: string): Promise<Buffer> {
  return readFile(resolveObjectPath(root, objectPath));
}

export async function removeOriginal(root: string, objectPath: string): Promise<void> {
  await unlink(resolveObjectPath(root, objectPath));
}
