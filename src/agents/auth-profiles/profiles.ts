import type { AuthProfileCredential, AuthProfileStore } from "./types.js";
import { normalizeSecretInput } from "../../utils/normalize-secret-input.js";
import { normalizeProviderId } from "../model-selection.js";
import {
  ensureAuthProfileStore,
  saveAuthProfileStore,
  updateAuthProfileStoreWithLock,
} from "./store.js";
import { storeAuthProfileSecret } from "./vault.js";

export async function setAuthProfileOrder(params: {
  agentDir?: string;
  provider: string;
  order?: string[] | null;
}): Promise<AuthProfileStore | null> {
  const providerKey = normalizeProviderId(params.provider);
  const sanitized =
    params.order && Array.isArray(params.order)
      ? params.order.map((entry) => String(entry).trim()).filter(Boolean)
      : [];

  const deduped: string[] = [];
  for (const entry of sanitized) {
    if (!deduped.includes(entry)) {
      deduped.push(entry);
    }
  }

  return await updateAuthProfileStoreWithLock({
    agentDir: params.agentDir,
    updater: (store) => {
      store.order = store.order ?? {};
      if (deduped.length === 0) {
        if (!store.order[providerKey]) {
          return false;
        }
        delete store.order[providerKey];
        if (Object.keys(store.order).length === 0) {
          store.order = undefined;
        }
        return true;
      }
      store.order[providerKey] = deduped;
      return true;
    },
  });
}

export function upsertAuthProfile(params: {
  profileId: string;
  credential: AuthProfileCredential;
  agentDir?: string;
}): void {
  const credential = normalizeCredentialForStorage(params.profileId, params.credential);
  const store = ensureAuthProfileStore(params.agentDir);
  store.profiles[params.profileId] = credential;
  saveAuthProfileStore(store, params.agentDir);
}

export async function upsertAuthProfileWithLock(params: {
  profileId: string;
  credential: AuthProfileCredential;
  agentDir?: string;
}): Promise<AuthProfileStore | null> {
  return await updateAuthProfileStoreWithLock({
    agentDir: params.agentDir,
    updater: (store) => {
      store.profiles[params.profileId] = normalizeCredentialForStorage(
        params.profileId,
        params.credential,
      );
      return true;
    },
  });
}

export function listProfilesForProvider(store: AuthProfileStore, provider: string): string[] {
  const providerKey = normalizeProviderId(provider);
  return Object.entries(store.profiles)
    .filter(([, cred]) => normalizeProviderId(cred.provider) === providerKey)
    .map(([id]) => id);
}

export async function markAuthProfileGood(params: {
  store: AuthProfileStore;
  provider: string;
  profileId: string;
  agentDir?: string;
}): Promise<void> {
  const { store, provider, profileId, agentDir } = params;
  const updated = await updateAuthProfileStoreWithLock({
    agentDir,
    updater: (freshStore) => {
      const profile = freshStore.profiles[profileId];
      if (!profile || profile.provider !== provider) {
        return false;
      }
      freshStore.lastGood = { ...freshStore.lastGood, [provider]: profileId };
      return true;
    },
  });
  if (updated) {
    store.lastGood = updated.lastGood;
    return;
  }
  const profile = store.profiles[profileId];
  if (!profile || profile.provider !== provider) {
    return;
  }
  store.lastGood = { ...store.lastGood, [provider]: profileId };
  saveAuthProfileStore(store, agentDir);
}

function normalizeCredentialForStorage(
  profileId: string,
  credential: AuthProfileCredential,
): AuthProfileCredential {
  if (credential.type === "api_key") {
    const normalizedKey = normalizeSecretInput(credential.key);
    if (!normalizedKey) {
      return { ...credential, key: undefined };
    }
    if (normalizedKey.startsWith("vault://")) {
      return { ...credential, key: normalizedKey, vaultRef: normalizedKey };
    }
    const stored = storeAuthProfileSecret({
      profileId,
      field: "key",
      value: normalizedKey,
    });
    if (!stored.ok) {
      return { ...credential, key: normalizedKey };
    }
    return { ...credential, key: stored.vaultRef, vaultRef: stored.vaultRef };
  }
  if (credential.type === "token") {
    const normalizedToken = normalizeSecretInput(credential.token);
    if (!normalizedToken) {
      return { ...credential, token: "" };
    }
    if (normalizedToken.startsWith("vault://")) {
      return { ...credential, token: normalizedToken, vaultRef: normalizedToken };
    }
    const stored = storeAuthProfileSecret({
      profileId,
      field: "token",
      value: normalizedToken,
    });
    if (!stored.ok) {
      return { ...credential, token: normalizedToken };
    }
    return { ...credential, token: stored.vaultRef, vaultRef: stored.vaultRef };
  }
  return credential;
}
