/**
 * A snippet in a link: `?playground=1<data>`, where the data is the snippet as UTF-8,
 * deflated (raw, no zlib header) and in base64url. The `1` is the format, so a later one
 * can be told apart. The docs site writes these links with Node's `zlib.deflateRawSync`
 * (`scripts/lib/docs/tryit.mjs` in scm-js), and Copy Link writes them here.
 *
 * A link only ever puts the snippet in the editor. Nothing runs until the user presses Run.
 */

export const PARAM = "playground";
const FORMAT = "1";
/** Longer than any snippet worth sharing, and short of what a server will take in a URL. */
export const MAX_LINK_CHARS = 8000;

function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function encodeSnippet(code: string): Promise<string> {
  return FORMAT + toBase64Url(await through(new TextEncoder().encode(code), new CompressionStream("deflate-raw")));
}

/** The snippet, or null for anything that is not a link this format writes. */
export async function decodeSnippet(value: string): Promise<string | null> {
  if (!value.startsWith(FORMAT)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(await through(fromBase64Url(value.slice(FORMAT.length)), new DecompressionStream("deflate-raw")));
  } catch {
    return null;
  }
}

/** The address of the editor this page is, opening `code` in the playground. */
export async function snippetLink(code: string, where: { origin: string; pathname: string } = location): Promise<string> {
  return `${where.origin}${where.pathname}?${PARAM}=${await encodeSnippet(code)}`;
}

/**
 * The snippet the page was opened with, taken out of the address bar so that a reload
 * does not offer it again. Null when there is none.
 */
export function takeFromAddress(): string | null {
  const url = new URL(location.href);
  const value = url.searchParams.get(PARAM);
  if (value === null) return null;
  url.searchParams.delete(PARAM);
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  return value;
}
