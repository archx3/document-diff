/**
 * Transcription, through this site: the page sends a recording here (only
 * after the reader agrees), and it is passed on to the transcription service
 * (server/transcribe), whose address is TRANSCRIBE_URL in the server's
 * environment (by default, the service's own default: this machine, port 8787). The service can then listen on this machine only, and the
 * page never needs to know where it is.
 *
 * GET says whether transcription is offered; POST transcribes one recording
 * (16 kHz mono WAV) and answers { text, words }.
 */
export const dynamic = 'force-dynamic';

/** The longest the service may take for one recording. */
const TIMEOUT_MS = 15 * 60 * 1000;

function service(): string {
  return (process.env.TRANSCRIBE_URL || 'http://127.0.0.1:8787').trim().replace(/\/+$/, '');
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(): Promise<Response> {
  const base = service();
  if (!base) return json({ available: false });
  try {
    const res = await fetch(`${base}/v1/health`, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    const health = (await res.json()) as { model?: string; maxSeconds?: number };
    return json({ available: res.ok, model: health.model, maxSeconds: health.maxSeconds });
  } catch {
    return json({ available: false });
  }
}

export async function POST(req: Request): Promise<Response> {
  const base = service();
  if (!base) return json({ error: 'transcription is not set up on this server' }, 503);
  if (!req.body) return json({ error: 'no recording was sent' }, 400);
  const lang = new URL(req.url).searchParams.get('lang') ?? 'auto';
  try {
    // Streamed straight through: the recording is not kept here either.
    const res = await fetch(`${base}/v1/transcribe?lang=${encodeURIComponent(lang)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: req.body,
      // Node's fetch needs this to send a stream.
      duplex: 'half',
      cache: 'no-store',
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(TIMEOUT_MS)]),
    } as RequestInit & { duplex: 'half' });
    return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch {
    return json({ error: 'the transcription service can’t be reached' }, 502);
  }
}
