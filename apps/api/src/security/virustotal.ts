/**
 * Optional VirusTotal lookups. We only ever send a file's SHA-256 *hash* for the
 * on-demand check — never the file contents — so enabling this does not leak data.
 * (Submitting the actual file is intentionally left as a future, explicit action.)
 */
export interface VirusTotalReport {
  available: boolean;
  found: boolean;
  malicious?: number;
  suspicious?: number;
  harmless?: number;
  permalink?: string;
}

export class VirusTotalClient {
  constructor(private readonly apiKey: string) {}

  get enabled(): boolean {
    return this.apiKey.length > 0;
  }

  /** Look up a file by its SHA-256 hash. Returns `found: false` if VT has never seen it. */
  async lookupHash(sha256: string): Promise<VirusTotalReport> {
    if (!this.enabled) return { available: false, found: false };

    const res = await fetch(`https://www.virustotal.com/api/v3/files/${sha256}`, {
      headers: { 'x-apikey': this.apiKey },
    });

    if (res.status === 404) return { available: true, found: false };
    if (!res.ok) {
      throw new Error(`VirusTotal request failed: ${res.status}`);
    }

    const body = (await res.json()) as {
      data?: { attributes?: { last_analysis_stats?: Record<string, number> } };
    };
    const stats = body.data?.attributes?.last_analysis_stats ?? {};
    return {
      available: true,
      found: true,
      malicious: stats.malicious ?? 0,
      suspicious: stats.suspicious ?? 0,
      harmless: stats.harmless ?? 0,
      permalink: `https://www.virustotal.com/gui/file/${sha256}`,
    };
  }
}
