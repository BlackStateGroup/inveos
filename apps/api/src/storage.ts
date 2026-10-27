import { constants } from 'node:fs';
import { chmod, mkdir, open, unlink } from 'node:fs/promises';
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
  extension: 'txt' | 'bin' = 'txt',
): Promise<StoredOriginal> {
  if (!isAbsolute(root)) {
    throw new Error('Storage root must be an absolute path.');
  }
  const objectPath = join(tenantId, caseId, `${evidenceId}.${extension}`);
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

export async function removeOriginal(root: string, objectPath: string): Promise<void> {
  await unlink(resolveObjectPath(root, objectPath));
}

/** Bounded original read: never allocate based on an untrusted replacement file. */
export async function readOriginalBounded(root: string, objectPath: string, maximum: number): Promise<Buffer> {
  const handle = await open(resolveObjectPath(root, objectPath), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!(await handle.stat()).isFile()) throw new Error('Original must be a regular file');
    const buffer = Buffer.alloc(maximum + 1);
    let length = 0;
    while (length < buffer.length) {
      const {bytesRead} = await handle.read(buffer,length,buffer.length-length,null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > maximum) throw new Error('Original size limit');
    return buffer.subarray(0,length);
  } finally { await handle.close(); }
}
