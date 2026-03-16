// Config-layer types: all fields optional (user may omit any field).
// Runtime types with required fields live in src/initiative/types.ts.
// Gateway startup resolves these to required-field NudgePolicy via resolveInitiativeNudgePolicy().

export interface InitiativeNudgePolicyConfig {
  maxNudgesPerHour?: number;
  quietHoursStart?: number;
  quietHoursEnd?: number;
  deduplicateWindowMs?: number;
  activeChannelWindowHours?: number;
}

export interface InitiativeConfig {
  enabled?: boolean;
  horizonScanIntervalMins?: number;
  nudgePolicy?: InitiativeNudgePolicyConfig;
}
