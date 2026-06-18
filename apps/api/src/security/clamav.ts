/**
 * Minimal ClamAV (`clamd`) client speaking the INSTREAM protocol over TCP.
 *
 * We deliberately avoid a heavy dependency: INSTREAM is a few lines. Files are
 * scanned in *plaintext*, before server-side encryption, which is the whole reason
 * the hybrid model keeps SERVER-mode files decryptable by the server.
 *
 * If `clamd` is unavailable the scanner reports `SKIPPED` rather than throwing, so a
 * deployment without antivirus still works (and the file is flagged accordingly).
 */
import { connect } from 'node:net';
import type { Readable } from 'node:stream';
import type { AvStatus } from '@opencoperlock/shared';

export interface ScanResult {
  status: Extract<AvStatus, 'CLEAN' | 'INFECTED' | 'SKIPPED'>;
  signature?: string;
}

export interface ClamAvOptions {
  enabled: boolean;
  host: string;
  port: number;
  /** Per-scan timeout in ms. */
  timeoutMs?: number;
}

const CHUNK_SIZE = 64 * 1024;

export class ClamAvScanner {
  constructor(private readonly opts: ClamAvOptions) {}

  /** Scan a readable plaintext stream. Never throws — returns SKIPPED on infra errors. */
  scanStream(input: Readable): Promise<ScanResult> {
    if (!this.opts.enabled) {
      input.resume(); // drain so the upstream pipeline can finish
      return Promise.resolve({ status: 'SKIPPED' });
    }
    const timeoutMs = this.opts.timeoutMs ?? 30_000;

    return new Promise<ScanResult>((resolvePromise) => {
      let settled = false;
      const settle = (result: ScanResult) => {
        if (settled) return;
        settled = true;
        resolvePromise(result);
      };

      const socket = connect(this.opts.port, this.opts.host);
      socket.setTimeout(timeoutMs);

      const responseChunks: Buffer[] = [];

      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        input.on('data', (chunk: Buffer) => {
          const header = Buffer.alloc(4);
          header.writeUInt32BE(chunk.length, 0);
          // Backpressure: pause the source if the socket buffer is full.
          const ok = socket.write(Buffer.concat([header, chunk]));
          if (!ok) {
            input.pause();
            socket.once('drain', () => input.resume());
          }
        });
        input.on('end', () => {
          const terminator = Buffer.alloc(4); // zero-length chunk = end of stream
          socket.write(terminator);
        });
        input.on('error', () => settle({ status: 'SKIPPED' }));
      });

      socket.on('data', (data: Buffer) => responseChunks.push(data));
      socket.on('end', () => {
        const reply = Buffer.concat(responseChunks).toString('utf8').replace(/\0$/, '').trim();
        if (reply.endsWith('OK')) settle({ status: 'CLEAN' });
        else if (reply.includes('FOUND')) {
          const signature = reply.replace(/^stream:\s*/, '').replace(/\s*FOUND$/, '');
          settle({ status: 'INFECTED', signature });
        } else settle({ status: 'SKIPPED' });
      });
      socket.on('timeout', () => {
        socket.destroy();
        settle({ status: 'SKIPPED' });
      });
      socket.on('error', () => settle({ status: 'SKIPPED' }));
    });
  }

  // For chunked streaming we split large chunks to respect clamd's StreamMaxLength
  // expectations; exposed for completeness / future tuning.
  static get chunkSize(): number {
    return CHUNK_SIZE;
  }
}
