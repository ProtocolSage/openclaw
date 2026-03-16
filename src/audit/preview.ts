import type { ApprovalPolicy } from "./types.js";

/**
 * Seam for future approval gating on irreversible tool calls.
 *
 * Currently: notifies via onYield but never blocks execution. The "required"
 * and "preview" policies both fall through to "timeout" (auto-approved).
 *
 * Next step (Second Wave): wire into the tool pipeline so "required"-policy
 * tools await an explicit owner response before proceeding, and "preview"
 * tools show a cancellable preview window.
 */
export class ActionPreview {
  async requestApproval(params: {
    toolName: string;
    policy: ApprovalPolicy;
    description: string;
    onYield?: (message: string) => Promise<void>;
    timeoutMs?: number;
  }): Promise<"approved" | "denied" | "timeout"> {
    if (params.policy === "none") {
      return "approved";
    }
    if (!params.onYield) {
      return "approved";
    }
    const prefix = params.policy === "required" ? "Approval required" : "Action preview";
    await params.onYield(`${prefix}: [${params.toolName}] ${params.description}`);
    if (params.policy === "preview") {
      const timeoutMs = Math.max(0, params.timeoutMs ?? 10_000);
      if (timeoutMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, timeoutMs));
      }
    }
    // TODO(second-wave): "required" policy should await owner confirmation via
    // channel interaction before returning. Until then, auto-approve after notification.
    return "timeout";
  }
}
