// src/verifier/store-adapters.ts
//
// Creates AuditStoreReader and FeedbackStoreReader adapters for gateway-level
// periodic scan. Each read opens a short-lived SQLite connection, queries, and
// closes. This avoids holding long-lived DB handles at gateway scope.

import * as fs from "node:fs";
import { AuditStore } from "../audit/store.js";
import { FeedbackStore } from "../feedback/store.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { AuditStoreReader, FeedbackStoreReader } from "./types.js";

const log = createSubsystemLogger("verifier");

export function createGatewayAuditReader(dbPath: string): AuditStoreReader {
  return {
    async getRecentEntries(
      goalId: string,
      opts: { maxEntries: number; maxMinutes: number },
    ): Promise<Array<{ toolName: string; outcome: string; at: number; toolInput?: string }>> {
      if (!fs.existsSync(dbPath)) {
        return [];
      }
      const store = new AuditStore();
      try {
        store.open(dbPath);
        const since = Date.now() - opts.maxMinutes * 60_000;
        const entries = store.query({
          goalId,
          since,
          limit: opts.maxEntries,
        });
        return entries.map((e) => ({
          toolName: e.toolName,
          outcome: e.outcome,
          at: e.at,
          toolInput: e.toolInput,
        }));
      } catch (err) {
        log.warn(`Audit reader failed for ${dbPath}: ${String(err)}`);
        return [];
      } finally {
        store.close();
      }
    },
  };
}

export function createGatewayFeedbackReader(dbPath: string): FeedbackStoreReader {
  return {
    async getRecentSignals(
      _goalId: string,
    ): Promise<Array<{ type: string; payload: unknown; at: number }>> {
      if (!fs.existsSync(dbPath)) {
        return [];
      }
      const store = new FeedbackStore();
      try {
        store.open(dbPath);
        const signals = store.listSignals({ limit: 50 });
        return signals.map((s) => ({
          type: s.type,
          // payload is always a string in FeedbackSignal; parse it for callers
          payload: (() => {
            try {
              return JSON.parse(s.payload) as unknown;
            } catch {
              return s.payload;
            }
          })(),
          at: s.at,
        }));
      } catch (err) {
        log.warn(`Feedback reader failed for ${dbPath}: ${String(err)}`);
        return [];
      } finally {
        store.close();
      }
    },

    async getOverrideStats(_goalId: string): Promise<{ confirmed: number; overridden: number }> {
      if (!fs.existsSync(dbPath)) {
        return { confirmed: 0, overridden: 0 };
      }
      const store = new FeedbackStore();
      try {
        store.open(dbPath);
        const overrides = store.listSignals({
          type: "verification_override",
          limit: 200,
        });
        const results = store.listSignals({
          type: "verification_result",
          limit: 200,
        });
        return {
          confirmed: results.length,
          overridden: overrides.length,
        };
      } catch (err) {
        log.warn(`Feedback override stats failed for ${dbPath}: ${String(err)}`);
        return { confirmed: 0, overridden: 0 };
      } finally {
        store.close();
      }
    },
  };
}
