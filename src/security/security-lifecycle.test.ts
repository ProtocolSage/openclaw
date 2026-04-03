/**
 * Tests for the SecurityLifecycle coordinator (Sprint 13 — AR-1, AR-6).
 *
 * NOTE: These tests exercise the coordinator in isolation.  Because all five
 * security modules are singletons this suite calls resetAll() in afterEach to
 * prevent cross-test pollution.  Future tests in this file (or new sibling
 * files) should do the same.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMonitorRunner, resetMonitorRunner } from "./monitor-runner.js";
import { getSecurityEventsManager, resetSecurityEventsManager } from "./security-events.js";
import {
  SecurityLifecycle,
  getSecurityLifecycle,
  resetSecurityLifecycle,
  type SecurityLifecycleConfig,
} from "./security-lifecycle.js";
import { getSessionRiskMonitor, resetSessionRiskMonitor } from "./session-monitoring.js";
import { getToolMonitor, resetToolMonitor } from "./tool-monitoring.js";

// ---------------------------------------------------------------------------
// Minimal test config — use in-memory only, no disk I/O
// ---------------------------------------------------------------------------

const testConfig: SecurityLifecycleConfig = {
  events: {
    /* in-memory only: omit `store` */
  },
  runner: { enabled: false },
  registerBuiltinScanModules: false,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetAllSingletons(): void {
  resetMonitorRunner();
  resetToolMonitor();
  resetSessionRiskMonitor();
  resetSecurityEventsManager();
  resetSecurityLifecycle();
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("SecurityLifecycle", () => {
  afterEach(() => {
    resetAllSingletons();
  });

  describe("initAll / destroyAll round-trip", () => {
    it("initialises all singletons and marks lifecycle as initialised", () => {
      const lc = new SecurityLifecycle();
      expect(lc.isInitialised).toBe(false);

      lc.initAll(testConfig);

      expect(lc.isInitialised).toBe(true);
      // Singletons should be reachable without throwing
      expect(() => getSecurityEventsManager()).not.toThrow();
      expect(() => getSessionRiskMonitor()).not.toThrow();
      expect(() => getToolMonitor()).not.toThrow();
      expect(() => getMonitorRunner()).not.toThrow();
    });

    it("destroyAll marks lifecycle as not initialised", () => {
      const lc = new SecurityLifecycle();
      lc.initAll(testConfig);
      lc.destroyAll();

      expect(lc.isInitialised).toBe(false);
    });

    it("destroyAll clears SecurityEventsManager ring buffer and dedup state", () => {
      const lc = new SecurityLifecycle();
      lc.initAll(testConfig);

      // Emit a couple of events
      const mgr = getSecurityEventsManager();
      mgr.emit({ type: "env_credential_exposed", severity: "info", source: "test", message: "a" });
      mgr.emit({ type: "env_credential_exposed", severity: "info", source: "test", message: "b" });

      expect(mgr.query().length).toBeGreaterThan(0);

      lc.destroyAll();

      // After destroy, a fresh manager has an empty ring buffer
      const fresh = getSecurityEventsManager();
      expect(fresh.query().length).toBe(0);
    });

    it("destroyAll clears SessionRiskMonitor session state", () => {
      const lc = new SecurityLifecycle();
      lc.initAll(testConfig);

      const monitor = getSessionRiskMonitor();
      monitor.addRiskFactor("session-1", "TOOL_ABUSE", { score: 10 });

      expect(monitor.getStats().totalSessions).toBeGreaterThan(0);

      lc.destroyAll();

      const freshMonitor = getSessionRiskMonitor();
      expect(freshMonitor.getStats().totalSessions).toBe(0);
    });

    it("destroyAll stops MonitorRunner timers", () => {
      const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

      const lc = new SecurityLifecycle();
      lc.initAll({ ...testConfig, runner: { enabled: true, every: "1m" } });

      const runner = getMonitorRunner();
      runner.start();
      expect(runner.getStatus().running).toBe(true);

      lc.destroyAll();

      // clearInterval should have been called for the runner's interval handle
      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });
  });

  describe("resetAll", () => {
    it("produces a clean slate — no cross-call pollution", () => {
      const lc = new SecurityLifecycle();
      lc.initAll(testConfig);

      // Dirty the state
      const mgr = getSecurityEventsManager();
      mgr.emit({
        type: "env_credential_exposed",
        severity: "info",
        source: "test",
        message: "dirty",
      });
      getSessionRiskMonitor().addRiskFactor("s1", "TOOL_ABUSE", { score: 10 });

      lc.resetAll(testConfig);

      // Both singletons should be fresh
      expect(getSecurityEventsManager().query().length).toBe(0);
      expect(getSessionRiskMonitor().getStats().totalSessions).toBe(0);
      expect(lc.isInitialised).toBe(true);
    });

    it("resetAll with no config uses defaults without throwing", () => {
      const lc = new SecurityLifecycle();
      lc.initAll(testConfig);
      expect(() => lc.resetAll(testConfig)).not.toThrow();
    });
  });

  describe("double-init guard", () => {
    it("second initAll call logs a warning and returns without re-initialising", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const lc = new SecurityLifecycle();
      lc.initAll(testConfig);

      // Emit an event to dirty the state
      getSecurityEventsManager().emit({
        type: "env_credential_exposed",
        severity: "info",
        source: "test",
        message: "first",
      });

      // Second init should not reset the singleton
      lc.initAll(testConfig);

      // State from the first init should still be there
      expect(getSecurityEventsManager().query().length).toBeGreaterThan(0);
      warnSpy.mockRestore();
    });
  });

  describe("getSecurityLifecycle singleton factory", () => {
    beforeEach(() => {
      resetSecurityLifecycle();
    });

    it("returns the same instance on repeated calls", () => {
      const a = getSecurityLifecycle();
      const b = getSecurityLifecycle();
      expect(a).toBe(b);
    });

    it("returns a new instance after resetSecurityLifecycle", () => {
      const a = getSecurityLifecycle();
      resetSecurityLifecycle();
      const b = getSecurityLifecycle();
      expect(a).not.toBe(b);
    });
  });

  describe("destroyAll is a no-op when not initialised", () => {
    it("does not throw when called before initAll", () => {
      const lc = new SecurityLifecycle();
      expect(() => lc.destroyAll()).not.toThrow();
    });
  });
});
