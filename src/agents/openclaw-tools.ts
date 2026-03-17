import type { AuditStore } from "../audit/store.js";
import type { OpenClawConfig } from "../config/config.js";
import type { FeedbackStore } from "../feedback/store.js";
import type { GoalManager } from "../goals/manager.js";
import { createDefaultEnvironmentWatcher, type EnvironmentWatcher } from "../initiative/index.js";
import { resolvePluginTools } from "../plugins/tools.js";
import { getActiveRuntimeWebToolsMetadata } from "../secrets/runtime.js";
import type { GatewayMessageChannel } from "../utils/message-channel.js";
import type { VerifierServices } from "../verifier/types.js";
import { resolveSessionAgentId } from "./agent-scope.js";
import type { SendToSessionFn } from "./coordination/aggregator.js";
import type { SandboxFsBridge } from "./sandbox/fs-bridge.js";
import type { SpawnedToolContext } from "./spawned-context.js";
import type { ToolFsPolicy } from "./tool-fs-policy.js";
import { createAgentsListTool } from "./tools/agents-list-tool.js";
import { createAuditTool } from "./tools/audit-tool.js";
import { createBrowserTool } from "./tools/browser-tool.js";
import { createCanvasTool } from "./tools/canvas-tool.js";
import type { AnyAgentTool } from "./tools/common.js";
import { createCronTool } from "./tools/cron-tool.js";
import { createFeedbackTool } from "./tools/feedback-tool.js";
import { createGatewayTool } from "./tools/gateway-tool.js";
import { createGoalsTool } from "./tools/goals-tool.js";
import { createImageTool } from "./tools/image-tool.js";
import { createMessageTool } from "./tools/message-tool.js";
import { createNodesTool } from "./tools/nodes-tool.js";
import { createPdfTool } from "./tools/pdf-tool.js";
import { createSessionStatusTool } from "./tools/session-status-tool.js";
import { createSessionsHistoryTool } from "./tools/sessions-history-tool.js";
import { createSessionsListTool } from "./tools/sessions-list-tool.js";
import { createSessionsSendTool } from "./tools/sessions-send-tool.js";
import { createSessionsSpawnTool } from "./tools/sessions-spawn-tool.js";
import { createSessionsYieldTool } from "./tools/sessions-yield-tool.js";
import { createSubagentsTool } from "./tools/subagents-tool.js";
import { createTasksTool } from "./tools/tasks-tool.js";
import { createTtsTool } from "./tools/tts-tool.js";
import { createWatchTool } from "./tools/watch-tool.js";
import { createWebFetchTool, createWebSearchTool } from "./tools/web-tools.js";
import { resolveWorkspaceRoot } from "./workspace-dir.js";

export function createOpenClawTools(
  options?: {
    goalManager?: GoalManager;
    sandboxBrowserBridgeUrl?: string;
    allowHostBrowserControl?: boolean;
    agentSessionKey?: string;
    agentChannel?: GatewayMessageChannel;
    agentAccountId?: string;
    /** Delivery target (e.g. telegram:group:123:topic:456) for topic/thread routing. */
    agentTo?: string;
    /** Thread/topic identifier for routing replies to the originating thread. */
    agentThreadId?: string | number;
    agentDir?: string;
    sandboxRoot?: string;
    sandboxFsBridge?: SandboxFsBridge;
    fsPolicy?: ToolFsPolicy;
    sandboxed?: boolean;
    config?: OpenClawConfig;
    pluginToolAllowlist?: string[];
    /** Current channel ID for auto-threading (Slack). */
    currentChannelId?: string;
    /** Current thread timestamp for auto-threading (Slack). */
    currentThreadTs?: string;
    /** Current inbound message id for action fallbacks (e.g. Telegram react). */
    currentMessageId?: string | number;
    /** Reply-to mode for Slack auto-threading. */
    replyToMode?: "off" | "first" | "all";
    /** Mutable ref to track if a reply was sent (for "first" mode). */
    hasRepliedRef?: { value: boolean };
    /** If true, the model has native vision capability */
    modelHasVision?: boolean;
    /** If true, nodes action="invoke" can call media-returning commands directly. */
    allowMediaInvokeCommands?: boolean;
    /** Explicit agent ID override for cron/hook sessions. */
    requesterAgentIdOverride?: string;
    /** Require explicit message targets (no implicit last-route sends). */
    requireExplicitMessageTarget?: boolean;
    /** If true, omit the message tool from the tool list. */
    disableMessageTool?: boolean;
    /** Trusted sender id from inbound context (not tool args). */
    requesterSenderId?: string | null;
    /** Whether the requesting sender is an owner. */
    senderIsOwner?: boolean;
    /** Ephemeral session UUID — regenerated on /new and /reset. */
    sessionId?: string;
    /**
     * Workspace directory to pass to spawned subagents for inheritance.
     * Defaults to workspaceDir. Use this to pass the actual agent workspace when the
     * session itself is running in a copied-workspace sandbox (`ro` or `none`) so
     * subagents inherit the real workspace path instead of the sandbox copy.
     */
    spawnWorkspaceDir?: string;
    /** Callback invoked when sessions_yield tool is called. */
    onYield?: (message: string) => Promise<void> | void;
    /** Callback used for internal inter-session notifications. */
    sendToSession?: SendToSessionFn;
    watcher?: EnvironmentWatcher;
    auditStore?: AuditStore;
    feedbackStore?: FeedbackStore;
    /** Gateway-shared verifier services for composing run-scoped context. */
    verifierServices?: VerifierServices;
  } & SpawnedToolContext,
): AnyAgentTool[] {
  const workspaceDir = resolveWorkspaceRoot(options?.workspaceDir);
  const spawnWorkspaceDir = resolveWorkspaceRoot(
    options?.spawnWorkspaceDir ?? options?.workspaceDir,
  );
  const runtimeWebTools = getActiveRuntimeWebToolsMetadata();
  const sandbox =
    options?.sandboxRoot && options?.sandboxFsBridge
      ? { root: options.sandboxRoot, bridge: options.sandboxFsBridge }
      : undefined;
  const imageTool = options?.agentDir?.trim()
    ? createImageTool({
        config: options?.config,
        agentDir: options.agentDir,
        workspaceDir,
        sandbox,
        fsPolicy: options?.fsPolicy,
        modelHasVision: options?.modelHasVision,
      })
    : null;
  const pdfTool = options?.agentDir?.trim()
    ? createPdfTool({
        config: options?.config,
        agentDir: options.agentDir,
        workspaceDir,
        sandbox,
        fsPolicy: options?.fsPolicy,
      })
    : null;
  const webSearchTool = createWebSearchTool({
    config: options?.config,
    sandboxed: options?.sandboxed,
    runtimeWebSearch: runtimeWebTools?.search,
  });
  const webFetchTool = createWebFetchTool({
    config: options?.config,
    sandboxed: options?.sandboxed,
    runtimeFirecrawl: runtimeWebTools?.fetch.firecrawl,
  });
  const messageTool = options?.disableMessageTool
    ? null
    : createMessageTool({
        agentAccountId: options?.agentAccountId,
        agentSessionKey: options?.agentSessionKey,
        config: options?.config,
        currentChannelId: options?.currentChannelId,
        currentChannelProvider: options?.agentChannel,
        currentThreadTs: options?.currentThreadTs,
        currentMessageId: options?.currentMessageId,
        replyToMode: options?.replyToMode,
        hasRepliedRef: options?.hasRepliedRef,
        sandboxRoot: options?.sandboxRoot,
        requireExplicitTarget: options?.requireExplicitMessageTarget,
        requesterSenderId: options?.requesterSenderId ?? undefined,
      });
  const sessionsSpawnTool = createSessionsSpawnTool({
    goalManager: options?.goalManager,
    agentSessionKey: options?.agentSessionKey,
    agentChannel: options?.agentChannel,
    agentAccountId: options?.agentAccountId,
    agentTo: options?.agentTo,
    agentThreadId: options?.agentThreadId,
    agentGroupId: options?.agentGroupId,
    agentGroupChannel: options?.agentGroupChannel,
    agentGroupSpace: options?.agentGroupSpace,
    sandboxed: options?.sandboxed,
    requesterAgentIdOverride: options?.requesterAgentIdOverride,
    workspaceDir: spawnWorkspaceDir,
  });
  const watcher = options?.watcher ?? createDefaultEnvironmentWatcher();
  const tools: AnyAgentTool[] = [
    createBrowserTool({
      sandboxBridgeUrl: options?.sandboxBrowserBridgeUrl,
      allowHostControl: options?.allowHostBrowserControl,
      agentSessionKey: options?.agentSessionKey,
    }),
    createCanvasTool({ config: options?.config }),
    createNodesTool({
      agentSessionKey: options?.agentSessionKey,
      agentChannel: options?.agentChannel,
      agentAccountId: options?.agentAccountId,
      currentChannelId: options?.currentChannelId,
      currentThreadTs: options?.currentThreadTs,
      config: options?.config,
      modelHasVision: options?.modelHasVision,
      allowMediaInvokeCommands: options?.allowMediaInvokeCommands,
    }),
    createCronTool({
      agentSessionKey: options?.agentSessionKey,
    }),
    createWatchTool({
      watcher,
      workspaceDir,
    }),
    ...(messageTool ? [messageTool] : []),
    createTtsTool({
      agentChannel: options?.agentChannel,
      config: options?.config,
    }),
    createGatewayTool({
      agentSessionKey: options?.agentSessionKey,
      config: options?.config,
    }),
    createAgentsListTool({
      agentSessionKey: options?.agentSessionKey,
      requesterAgentIdOverride: options?.requesterAgentIdOverride,
    }),
    ...(options?.auditStore ? [createAuditTool({ auditStore: options.auditStore })] : []),
    ...(options?.feedbackStore && options?.agentDir
      ? [
          createFeedbackTool({
            feedbackStore: options.feedbackStore,
            agentId: options.requesterAgentIdOverride ?? "default",
            sessionKey: options.agentSessionKey ?? "unknown",
            agentDir: options.agentDir,
          }),
        ]
      : []),
    createSessionsListTool({
      agentSessionKey: options?.agentSessionKey,
      sandboxed: options?.sandboxed,
      config: options?.config,
    }),
    createSessionsHistoryTool({
      agentSessionKey: options?.agentSessionKey,
      sandboxed: options?.sandboxed,
      config: options?.config,
    }),
    createSessionsSendTool({
      agentSessionKey: options?.agentSessionKey,
      agentChannel: options?.agentChannel,
      sandboxed: options?.sandboxed,
      config: options?.config,
    }),
    createSessionsYieldTool({
      sessionId: options?.sessionId,
      onYield: options?.onYield,
    }),
    sessionsSpawnTool,
    createSubagentsTool({
      agentSessionKey: options?.agentSessionKey,
    }),
    createSessionStatusTool({
      agentSessionKey: options?.agentSessionKey,
      config: options?.config,
      sandboxed: options?.sandboxed,
    }),
    ...(webSearchTool ? [webSearchTool] : []),
    ...(webFetchTool ? [webFetchTool] : []),
    ...(imageTool ? [imageTool] : []),
    ...(pdfTool ? [pdfTool] : []),
    ...(options?.goalManager
      ? [
          createGoalsTool({
            goalManager: options.goalManager,
            feedbackStore: options.feedbackStore,
            agentId: options.requesterAgentIdOverride,
            sessionKey: options.agentSessionKey,
          }),
          createTasksTool({
            goalManager: options.goalManager,
            feedbackStore: options.feedbackStore,
            agentId: options.requesterAgentIdOverride,
            sessionKey: options.agentSessionKey,
            sendToSession: options.sendToSession,
            spawnTaskSession: async (params) => {
              const result = await sessionsSpawnTool.execute(`tasks-delegate-${params.taskId}`, {
                task: params.task,
                taskId: params.taskId,
                roleId: params.roleId,
                runtime: params.runtime,
                agentId: params.agentId,
                model: params.model,
                thinking: params.thinking,
                runTimeoutSeconds: params.runTimeoutSeconds,
                sandbox: params.sandbox,
              });
              return result.details as Record<string, unknown>;
            },
          }),
        ]
      : []),
  ];

  const pluginTools = resolvePluginTools({
    context: {
      config: options?.config,
      workspaceDir,
      agentDir: options?.agentDir,
      agentId: resolveSessionAgentId({
        sessionKey: options?.agentSessionKey,
        config: options?.config,
      }),
      sessionKey: options?.agentSessionKey,
      sessionId: options?.sessionId,
      messageChannel: options?.agentChannel,
      agentAccountId: options?.agentAccountId,
      requesterSenderId: options?.requesterSenderId ?? undefined,
      senderIsOwner: options?.senderIsOwner ?? undefined,
      sandboxed: options?.sandboxed,
    },
    existingToolNames: new Set(tools.map((tool) => tool.name)),
    toolAllowlist: options?.pluginToolAllowlist,
  });

  return [...tools, ...pluginTools];
}
