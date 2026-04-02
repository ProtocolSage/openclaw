/**
 * Security Lifecycle Coordinator — Sprint 13 (AR-1, AR-6)
 *
 * Provides a single entry-point for initialising and tearing down all five
 * security singletons in the correct dependency order:
 *
 *   init:    events → session → tool → vault → runner
 *   destroy: runner → vault → tool → session → events  (reverse)
 *
 * Use `getSecurityLifecycle()` to obtain the singleton coordinator, then call
 * `initAll()` once at application startup and `destroyAll()` on graceful
 * shutdown.  `resetAll()` is the test-isolation helper: it destroys then
 * re-creates everything in one call.
 *
 * Individual singletons are still accessible via their own `get*()` factories
 * after `initAll()` completes.
 */

import { createSubsystemLogger } from "../logging/subsystem.js";
import { resetAuditHashCacheForTest } from "./credential-audit.js";
import { resetVaultForTest } from "./credential-vault.js";
import {
  getMonitorRunner,
  registerBuiltinModules,
  resetMonitorRunner,
  type MonitorRunnerConfig,
} from "./monitor-runner.js";
import {
  getSecurityEventsManager,
  resetSecurityEventsManager,
  type AlertingConfig,
  type SecurityEventsConfig,
} from "./security-events.js";
import {
  getSessionRiskMonitor,
  resetSessionRiskMonitor,
  type SessionMonitoringConfig,
} from "./session-monitoring.js";
import { getToolMonitor, resetToolMonitor, type ToolMonitoringConfig } from "./tool-monitoring.js";

const log = createSubsystemLogger("security/lifecycle");

// -----------------------------------------------------------------------------
// Config bundle
// -----------------------------------------------------------------------------

export type SecurityLifecycleConfig = {
  events?: SecurityEventsConfig;
  alerting?: AlertingConfig;
  session?: SessionMonitoringConfig;
  tool?: ToolMonitoringConfig;
  runner?: MonitorRunnerConfig;
  /** When true, `initAll()` calls `registerBuiltinModules()` on the runner. */
  registerBuiltinScanModules?: boolean;
};

// -----------------------------------------------------------------------------
// Coordinator class
// -----------------------------------------------------------------------------

export class SecurityLifecycle {
  private initialised = false;

  /**
   * Initialise all five singletons in dependency order.
   * Calling `initAll()` a second time without an intervening `destroyAll()` is
   * a no-op (with a warning).
   */
  initAll(config?: SecurityLifecycleConfig): void {
    if (this.initialised) {
      log.warn("SecurityLifecycle.initAll() called while already initialised — ignoring");
      return;
    }

    // 1. Events — other singletons emit to this
    getSecurityEventsManager(config?.events, config?.alerting);

    // 2. Session monitor
    getSessionRiskMonitor(config?.session);

    // 3. Tool monitor
    getToolMonitor(config?.tool);

    // 4. Vault — stateless after module load; reset cache for clean init
    resetVaultForTest();

    // 5. Monitor runner — last, as it depends on the event bus
    const runner = getMonitorRunner(config?.runner);
    if (config?.registerBuiltinScanModules !== false) {
      registerBuiltinModules(runner);
    }

    this.initialised = true;
    log.info("security subsystem initialised");
  }

  /**
   * Tear down all five singletons in reverse dependency order.
   * Flushes pending writes and clears all in-memory state before resetting the
   * singleton references so `get*()` factories return fresh instances next time.
   */
  destroyAll(): void {
    if (!this.initialised) {
      return;
    }

    // 5 → 1: reverse init order

    // Runner — stop timers and clear scan modules (resetMonitorRunner calls stop() internally)
    resetMonitorRunner();

    // Vault — clear last-hash cache
    resetAuditHashCacheForTest();
    resetVaultForTest();

    // Tool monitor — clear call history
    getToolMonitor().destroy();
    resetToolMonitor();

    // Session monitor — clear session state
    getSessionRiskMonitor().destroy();
    resetSessionRiskMonitor();

    // Events — flush writes, clear ring buffer and listeners
    getSecurityEventsManager().destroy();
    resetSecurityEventsManager();

    this.initialised = false;
    log.info("security subsystem destroyed");
  }

  /**
   * Convenience helper for test isolation: destroys then re-initialises all
   * singletons with the supplied config (or no config for defaults).
   */
  resetAll(config?: SecurityLifecycleConfig): void {
    this.destroyAll();
    this.initAll(config);
  }

  get isInitialised(): boolean {
    return this.initialised;
  }
}

// -----------------------------------------------------------------------------
// Singleton factory
// -----------------------------------------------------------------------------

let defaultLifecycle: SecurityLifecycle | undefined;

/**
 * Get or create the default `SecurityLifecycle` coordinator.
 *
 * The lifecycle object itself is a lightweight coordinator — it holds no
 * security state; all state lives in the individual singleton modules.
 */
export function getSecurityLifecycle(): SecurityLifecycle {
  if (!defaultLifecycle) {
    defaultLifecycle = new SecurityLifecycle();
  }
  return defaultLifecycle;
}

/**
 * Reset the lifecycle singleton — for testing only.
 * Does NOT call `destroyAll()`; use `getSecurityLifecycle().destroyAll()` first
 * if you need a clean teardown.
 */
export function resetSecurityLifecycle(): void {
  defaultLifecycle = undefined;
}
