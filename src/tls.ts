/**
 * Trust what Windows trusts. Antivirus HTTPS scanning (Norton, Kaspersky, Avast…) and company proxies
 * re-sign TLS traffic with a root certificate that is installed only in the Windows certificate store.
 * Deno verifies against its bundled Mozilla roots, so every request would fail with "invalid peer
 * certificate: UnknownIssuer". Load the Windows roots once (cached for a day) into an HTTP client.
 */
import { join } from "node:path";
import { DATA_DIR } from "./config.ts";
import { log } from "./log.ts";
import { powershell } from "./system.ts";

const PEM_RE = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;
let client: Deno.HttpClient | undefined;

export const httpClient = () => client;

async function windowsRoots(): Promise<string[]> {
  const cache = join(DATA_DIR, "windows-roots.pem");
  try {
    if (Date.now() - (Deno.statSync(cache).mtime?.getTime() ?? 0) < 86_400_000) {
      return Deno.readTextFileSync(cache).match(PEM_RE) ?? [];
    }
  } catch { /* no cache yet */ }
  const r = await powershell(
    `Get-ChildItem Cert:\\LocalMachine\\Root, Cert:\\CurrentUser\\Root | ForEach-Object {
  "-----BEGIN CERTIFICATE-----"
  [Convert]::ToBase64String($_.RawData, 'InsertLineBreaks')
  "-----END CERTIFICATE-----"
}`,
    30_000,
  );
  const certs = [...new Set(r.stdout.replace(/\r/g, "").match(PEM_RE) ?? [])];
  if (!certs.length) log("could not read the Windows certificate store", r.stderr.slice(-300));
  try {
    Deno.mkdirSync(DATA_DIR, { recursive: true });
    if (certs.length) Deno.writeTextFileSync(cache, certs.join("\n"));
  } catch { /* the cache is only an optimisation */ }
  return certs;
}

// short-lived pooled connections: a TLS-inspecting proxy can leave idle ones half-dead
const POOL = { poolIdleTimeout: 30_000, poolMaxIdlePerHost: 2 };

export async function initTls() {
  if (Deno.build.os !== "windows" || /system/.test(Deno.env.get("DENO_TLS_CA_STORE") ?? "")) return;
  try {
    let certs = await windowsRoots();
    try {
      client = Deno.createHttpClient({ caCerts: certs, ...POOL });
    } catch {
      // one malformed entry spoils the batch; keep the ones that load
      certs = certs.filter((c) => {
        try {
          Deno.createHttpClient({ caCerts: [c] }).close();
          return true;
        } catch {
          return false;
        }
      });
      client = Deno.createHttpClient({ caCerts: certs, ...POOL });
    }
    log(`TLS: trusting ${certs.length} Windows root certificates in addition to Deno's own`);
  } catch (e) {
    log("TLS: falling back to Deno's bundled roots", e);
  }
}
