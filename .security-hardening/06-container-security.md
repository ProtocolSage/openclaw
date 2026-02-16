# Step 6: Container Security Hardening (Phase 3)

**Status:** COMPLETED
**Date:** 2026-02-13
**Phase:** 3 - Container Security Hardening

---

## Summary

This phase implemented comprehensive container security hardening to prevent sandbox escapes and limit the blast radius of compromised containers.

## Changes Made

### 1. Hardened Sandbox Default Constants

**File:** [src/agents/sandbox/constants.ts](../src/agents/sandbox/constants.ts)

Added security-focused default constants:

| Constant                          | Value             | Purpose                              |
| --------------------------------- | ----------------- | ------------------------------------ |
| `DEFAULT_SANDBOX_PIDS_LIMIT`      | 100               | Prevents fork bombs                  |
| `DEFAULT_SANDBOX_MEMORY`          | "512m"            | Prevents memory exhaustion           |
| `DEFAULT_SANDBOX_MEMORY_SWAP`     | "512m"            | Prevents swap abuse                  |
| `DEFAULT_SANDBOX_CPUS`            | 0.5               | Prevents CPU exhaustion              |
| `DEFAULT_SANDBOX_ULIMITS`         | See below         | Resource constraints                 |
| `DEFAULT_SANDBOX_SECCOMP_PROFILE` | "openclaw-strict" | Syscall filtering                    |
| `DEFAULT_SANDBOX_DNS`             | []                | Disables DNS (prevents exfiltration) |

**Ulimits:**

```typescript
{
  nofile: { soft: 1024, hard: 2048 },
  nproc: { soft: 50, hard: 100 },
  core: 0,  // Disable core dumps
}
```

### 2. Updated Sandbox Configuration

**File:** [src/agents/sandbox/config.ts](../src/agents/sandbox/config.ts)

- Integrated hardened defaults into `resolveSandboxDockerConfig()`
- All new sandboxes now use secure defaults by default
- Existing config fields still allow override for special cases

**Applied by default:**

- Read-only root filesystem
- Network isolation (none)
- All capabilities dropped
- PID limit: 100
- Memory limit: 512MB
- CPU limit: 0.5 cores
- Seccomp profile: openclaw-strict
- DNS disabled

### 3. Seccomp Profile

**File:** [docker/seccomp/openclaw-strict.json](../docker/seccomp/openclaw-strict.json)

Created strict seccomp profile using default-deny approach:

**Allowed syscalls (~150):**

- Basic I/O: read, write, open, close, stat, etc.
- Memory management: mmap, mprotect, munmap, brk
- Process control: fork, execve, exit (no ptrace)
- Networking: socket, connect, bind (controlled)
- Filesystem: limited operations, no mount

**Blocked syscalls (critical):**

- `ptrace` - Process debugging/injection
- `mount`, `umount2` - Filesystem manipulation
- `setns`, `unshare` - Namespace manipulation
- `init_module`, `finit_module` - Kernel module loading
- `kexec_load` - Kernel execution
- `bpf` - eBPF programs
- `userfaultfd` - Memory manipulation
- `setuid`, `setgid`, `capset` - Privilege escalation

### 4. Container Escape Monitoring

**File:** [src/security/container-monitor.ts](../src/security/container-monitor.ts)

Created runtime monitoring module with detection for:

| Check                  | Type       | Severity | Description                                |
| ---------------------- | ---------- | -------- | ------------------------------------------ |
| Host PID access        | process    | critical | Container accessing host process namespace |
| Sensitive file access  | file       | critical | Access to docker.sock, /etc/shadow, etc.   |
| Network escape         | network    | warn     | Container has active network connections   |
| Dangerous capabilities | capability | critical | Elevated Linux capabilities detected       |
| Suspicious mounts      | mount      | critical | Host filesystem or credential file mounts  |

**API:**

```typescript
// Run comprehensive escape detection
detectContainerEscape(containerId): Promise<ContainerMonitorResult>

// Emergency kill if escape detected
emergencyContainerKill(containerId): Promise<void>

// Combined monitor + auto-kill
monitorContainerWithKill(containerId): Promise<ContainerMonitorResult>
```

## Files Modified/Created

| File                                  | Action                           |
| ------------------------------------- | -------------------------------- |
| `src/agents/sandbox/constants.ts`     | Added hardened default constants |
| `src/agents/sandbox/config.ts`        | Updated to use hardened defaults |
| `docker/seccomp/openclaw-strict.json` | Created strict seccomp profile   |
| `src/security/container-monitor.ts`   | Created escape monitoring module |

## Existing Security Features (Preserved)

The codebase already had these security defaults:

- `readOnlyRoot: true`
- `network: "none"`
- `capDrop: ["ALL"]`
- `tmpfs: ["/tmp", "/var/tmp", "/run"]`

## Verification

```bash
# Verify TypeScript compiles
source ~/.nvm/nvm.sh && nvm use 22
npx tsc --noEmit

# Test container escape detection (requires Docker)
npx tsx -e "
import { detectContainerEscape } from './src/security/container-monitor.ts';
// Run detection on test container
const result = await detectContainerEscape('test-container-id');
console.log(result);
"
```

## Integration Notes

To use the hardened sandbox:

1. **Automatic:** All new sandboxes use hardened defaults automatically
2. **Seccomp:** Ensure `docker/seccomp/openclaw-strict.json` is available at runtime
3. **Monitoring:** Call `monitorContainerWithKill()` periodically or on suspicious activity

## Next Steps

- Phase 4: Prompt Injection Defense
- Phase 5: Credential Protection
- Phase 6: Monitoring & Detection
- Phase 7: User Education

## SECURITY.md Control Alignment (Step 6)

- `Runtime Requirements > Docker Security`: hardened container runtime defaults follow non-root execution, capability minimization, and restricted filesystem guidance.
- `Runtime Requirements > Node.js Version`: container images and runtime validation align to Node.js 22.12.0+ baseline.
- `Operational Guidance > Web Interface Safety`: containerized deployments preserve loopback-first gateway exposure unless explicitly tunneled and authenticated.
