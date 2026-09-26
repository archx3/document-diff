import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let available: boolean | undefined;

/** Whether LibreOffice (`soffice`) is installed. */
export function hasLibreOffice(): boolean {
  if (available === undefined) {
    try {
      execFileSync('soffice', ['--version'], { stdio: 'pipe', timeout: 60_000 });
      available = true;
    } catch {
      available = false;
    }
  }
  return available;
}

/**
 * Writes `bytes` to `dir/name` and returns the text LibreOffice reads from it,
 * or null when LibreOffice is not installed. Each test process uses its own
 * LibreOffice profile, so test files can convert at the same time.
 */
export function libreOfficeText(bytes: Uint8Array | null, dir: string, name: string): string | null {
  if (!hasLibreOffice()) return null;
  const path = join(dir, name);
  if (bytes) writeFileSync(path, bytes);
  const profile = `file://${join(tmpdir(), `collate-lo-${process.pid}`)}`;
  execFileSync('soffice', [`-env:UserInstallation=${profile}`, '--headless', '--convert-to', 'txt:Text', '--outdir', dir, path], { stdio: 'pipe', timeout: 120_000 });
  return readFileSync(path.replace(/\.[^./]+$/, '.txt'), 'utf8');
}
