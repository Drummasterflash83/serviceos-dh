import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, join, parse, resolve } from 'node:path';

/** Reject a private source artifact anywhere inside a Git checkout, including worktrees. */
export async function privateOutputPath(path) {
  const parent = await realpath(dirname(resolve(path)));
  for (let dir = parent; ; dir = dirname(dir)) {
    try {
      await lstat(join(dir, '.git'));
      throw Error('private_output_inside_git_checkout');
    } catch (error) {
      if (error?.message === 'private_output_inside_git_checkout') throw error;
      if (error?.code !== 'ENOENT') throw error;
    }
    if (dir === parse(dir).root) break;
  }
  return join(parent, basename(path));
}
