export interface NudgePolicy {
  maxNudgesPerHour: number;
  quietHoursStart: number;
  quietHoursEnd: number;
  deduplicateWindowMs: number;
  activeChannelWindowHours: number;
}

export interface InitiativeConfig {
  enabled: boolean;
  horizonScanIntervalMins: number;
  nudgePolicy: NudgePolicy;
}

export type HorizonScanResult = {
  scanned: number;
  nudged: number;
  skipped: number;
};

export type WatchRecord =
  | {
      id: string;
      kind: "file";
      path: string;
      createdAt: number;
    }
  | {
      id: string;
      kind: "http";
      url: string;
      createdAt: number;
    };
