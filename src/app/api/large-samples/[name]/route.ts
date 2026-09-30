/**
 * One of the large samples (src/lib/large-samples.ts), streamed from where
 * `npm run samples:large` made it, for the page at /samples/large/. Only in
 * development, or with LARGE_SAMPLES=1; only the files that page lists.
 */
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { LARGE_DIR, largeSamplesOn, largeSize, largeType } from '../../../../lib/large-samples';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }): Promise<Response> {
  const { name } = await params;
  const size = largeSamplesOn() ? largeSize(name) : null;
  if (size === null) return new Response('Not found', { status: 404 });
  const body = Readable.toWeb(createReadStream(join(LARGE_DIR, name))) as ReadableStream<Uint8Array>;
  return new Response(body, {
    headers: {
      'Content-Type': largeType(name),
      'Content-Length': String(size),
      'Content-Disposition': `inline; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });
}
