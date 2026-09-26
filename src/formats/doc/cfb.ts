/**
 * Reader for Compound File Binary (OLE2) containers, the storage format of
 * Word 97–2003 .doc files.
 */

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;

export function isCfb(data: Uint8Array): boolean {
  return data.length >= 512 && SIGNATURE.every((b, i) => data[i] === b);
}

interface Entry {
  name: string;
  type: number;
  start: number;
  size: number;
}

export class Cfb {
  private readonly dv: DataView;
  private readonly sectorSize: number;
  private readonly miniSectorSize: number;
  private readonly miniCutoff: number;
  private readonly fat: Uint32Array;
  private miniFat: Uint32Array | null = null;
  private miniStream: Uint8Array | null = null;
  readonly entries: Entry[] = [];

  constructor(private readonly data: Uint8Array) {
    if (!isCfb(data)) throw new Error('Not a compound file');
    this.dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const u16 = (o: number) => this.dv.getUint16(o, true);
    const u32 = (o: number) => this.dv.getUint32(o, true);
    this.sectorSize = 1 << u16(0x1e);
    this.miniSectorSize = 1 << u16(0x20);
    this.miniCutoff = u32(0x38) || 4096;
    if (this.sectorSize !== 512 && this.sectorSize !== 4096) throw new Error('Unsupported compound file sector size');

    // The FAT sectors are listed in the header (first 109) and then in a chain of DIFAT sectors.
    const fatSectors: number[] = [];
    const numFat = u32(0x2c);
    for (let i = 0; i < 109 && fatSectors.length < numFat; i++) {
      const s = u32(0x4c + i * 4);
      if (s !== FREESECT) fatSectors.push(s);
    }
    let difat = u32(0x44);
    const perSector = this.sectorSize / 4;
    for (let guard = 0; difat !== ENDOFCHAIN && difat !== FREESECT && fatSectors.length < numFat && guard < 1e5; guard++) {
      const off = this.offset(difat);
      for (let i = 0; i < perSector - 1 && fatSectors.length < numFat; i++) {
        const s = u32(off + i * 4);
        if (s !== FREESECT) fatSectors.push(s);
      }
      difat = u32(off + (perSector - 1) * 4);
    }
    this.fat = new Uint32Array(fatSectors.length * perSector);
    fatSectors.forEach((s, i) => {
      const off = this.offset(s);
      for (let k = 0; k < perSector; k++) this.fat[i * perSector + k] = u32(off + k * 4);
    });

    const dir = this.chain(u32(0x30));
    for (let off = 0; off + 128 <= dir.length; off += 128) {
      const ddv = new DataView(dir.buffer, dir.byteOffset + off, 128);
      const nameLen = ddv.getUint16(0x40, true);
      let name = '';
      for (let i = 0; i + 2 < nameLen && i < 64; i += 2) name += String.fromCharCode(ddv.getUint16(i, true));
      this.entries.push({ name, type: ddv.getUint8(0x42), start: ddv.getUint32(0x74, true), size: ddv.getUint32(0x78, true) });
    }
    const miniFatStart = u32(0x3c);
    if (miniFatStart !== ENDOFCHAIN && miniFatStart !== FREESECT) {
      const mf = this.chain(miniFatStart);
      this.miniFat = new Uint32Array(mf.length / 4);
      const mdv = new DataView(mf.buffer, mf.byteOffset, mf.byteLength);
      for (let i = 0; i < this.miniFat.length; i++) this.miniFat[i] = mdv.getUint32(i * 4, true);
    }
    const root = this.entries[0];
    if (root && root.type === 5 && root.start !== ENDOFCHAIN) this.miniStream = this.chain(root.start, root.size);
  }

  private offset(sector: number): number {
    return (sector + 1) * this.sectorSize;
  }

  /** Bytes of a regular sector chain. */
  private chain(start: number, size?: number): Uint8Array {
    const parts: number[] = [];
    const seen = new Set<number>();
    for (let s = start; s !== ENDOFCHAIN && s !== FREESECT && s < this.fat.length && !seen.has(s); s = this.fat[s]!) {
      seen.add(s);
      parts.push(s);
    }
    const total = size ?? parts.length * this.sectorSize;
    const out = new Uint8Array(Math.min(total, parts.length * this.sectorSize));
    parts.forEach((s, i) => {
      const off = this.offset(s);
      const len = Math.min(this.sectorSize, out.length - i * this.sectorSize);
      if (len > 0) out.set(this.data.subarray(off, off + len), i * this.sectorSize);
    });
    return out;
  }

  private miniChain(start: number, size: number): Uint8Array {
    const out = new Uint8Array(size);
    if (!this.miniFat || !this.miniStream) return out;
    let pos = 0;
    const seen = new Set<number>();
    for (let s = start; s !== ENDOFCHAIN && s !== FREESECT && pos < size && !seen.has(s); s = this.miniFat[s] ?? ENDOFCHAIN) {
      seen.add(s);
      const off = s * this.miniSectorSize;
      const len = Math.min(this.miniSectorSize, size - pos);
      out.set(this.miniStream.subarray(off, off + len), pos);
      pos += len;
    }
    return out;
  }

  /** Contents of the stream with the given name (case-insensitive), or undefined. */
  stream(name: string): Uint8Array | undefined {
    const lower = name.toLowerCase();
    const e = this.entries.find((x) => x.type === 2 && x.name.toLowerCase() === lower);
    if (!e) return undefined;
    return e.size < this.miniCutoff ? this.miniChain(e.start, e.size) : this.chain(e.start, e.size);
  }
}
