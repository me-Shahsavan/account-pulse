import fs from "node:fs";
import path from "node:path";

// Minimal local store for the grant id. Deliberately not a database:
// this prototype connects one test account, so a JSON file is honest.
const DATA_DIR = path.resolve(".data");
const GRANT_FILE = path.join(DATA_DIR, "grant.json");

export interface StoredGrant {
  grantId: string;
  email: string;
  connectedAt: string;
}

export function saveGrant(grant: StoredGrant): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(GRANT_FILE, JSON.stringify(grant, null, 2));
}

export function loadGrant(): StoredGrant | null {
  try {
    return JSON.parse(fs.readFileSync(GRANT_FILE, "utf8")) as StoredGrant;
  } catch {
    return null;
  }
}

export function clearGrant(): void {
  try {
    fs.rmSync(GRANT_FILE);
  } catch {
    // already gone
  }
}

export function requireGrant(): StoredGrant {
  const grant = loadGrant();
  if (!grant) {
    throw new Error(
      "No connected account. Start the server (npm run dev) and visit /auth to connect one.",
    );
  }
  return grant;
}
