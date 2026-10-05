import { createHash } from "node:crypto";
import { normalizeBaseUrl } from "../api/url";
import type { Credentials } from "../types";

const service = "com.edgey.cli";
const maxKeyLength = 4096;

export function normalizeApiKey(value: string): string {
  if (typeof value !== "string" || value.length > maxKeyLength) {
    throw new Error("invalid api key.");
  }
  const key = value.trim();
  // ten sam alfabet co bearer w adapterze; wyklucza też niewidoczne znaki unicode.
  if (!key || /[^\x21-\x7e]/.test(key)) throw new Error("invalid api key.");
  return key;
}

function credentialName(baseUrl: string): string {
  try {
    return createHash("sha256").update(normalizeBaseUrl(baseUrl)).digest("hex");
  } catch {
    throw new Error("invalid api address for credentials.");
  }
}

/** backend można wstrzyknąć w testach bez dostępu do magazynu systemowego. */
export class SystemCredentials implements Credentials {
  readonly #secrets: typeof Bun.secrets;

  constructor(secrets: typeof Bun.secrets = Bun.secrets) {
    this.#secrets = secrets;
  }

  async get(baseUrl: string): Promise<string | null> {
    const name = credentialName(baseUrl);
    try {
      const value = await this.#secrets.get({ service, name });
      return value === null ? null : normalizeApiKey(value);
    } catch {
      throw new Error("could not read the key from the system credential store.");
    }
  }

  async set(baseUrl: string, key: string): Promise<void> {
    const name = credentialName(baseUrl);
    const value = normalizeApiKey(key);
    try {
      await this.#secrets.set({ service, name, value });
    } catch {
      throw new Error("could not save the key to the system credential store.");
    }
  }

  async delete(baseUrl: string): Promise<void> {
    const name = credentialName(baseUrl);
    try {
      await this.#secrets.delete({ service, name });
    } catch {
      throw new Error("could not delete the key from the system credential store.");
    }
  }
}

/** jawny tryb bieżącego uruchomienia, wybierany przez wywołującego. */
export class MemoryCredentials implements Credentials {
  readonly #keys = new Map<string, string>();

  async get(baseUrl: string): Promise<string | null> {
    return this.#keys.get(credentialName(baseUrl)) ?? null;
  }

  async set(baseUrl: string, key: string): Promise<void> {
    this.#keys.set(credentialName(baseUrl), normalizeApiKey(key));
  }

  async delete(baseUrl: string): Promise<void> {
    this.#keys.delete(credentialName(baseUrl));
  }
}
