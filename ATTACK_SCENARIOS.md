# Attack Scenario Documentation

## OpenClaw/Moltbot Phase 2 Threat Model - Detailed Attack Flows

**Date:** 2026-02-10
**Classification:** INTERNAL - SECURITY SENSITIVE
**Purpose:** Detailed attack scenario walkthroughs for security testing and validation

---

## ⚠️ CRITICAL WARNING ⚠️

**THIS DOCUMENT CONTAINS MALICIOUS CODE EXAMPLES FOR SECURITY RESEARCH ONLY**

All code snippets in this document are **MALICIOUS ATTACK PAYLOADS** used for:

- Threat modeling analysis
- Security scanner validation
- Penetration testing reference

**DO NOT execute any code from this document in production environments.**
**DO NOT use these techniques for unauthorized access or malicious purposes.**

This documentation demonstrates attack vectors to improve defenses, not to enable attacks.

---

## Table of Contents

1. [Scenario 1: Sleeper Agent - 30-Day Delayed Credential Theft](#scenario-1-sleeper-agent)
2. [Scenario 2: Container Escape - Host Compromise via Docker Socket](#scenario-2-container-escape)
3. [Scenario 3: Credential Harvesting - Multi-Vector Exfiltration](#scenario-3-credential-harvesting)
4. [Scenario 4: Combined Attack - Sleeper + Escape + Harvest](#scenario-4-combined-attack)

---

## Scenario 1: Sleeper Agent - 30-Day Delayed Credential Theft

### Attack Overview

**Attack Type:** Time-delayed malicious code execution (CWE-506)
**CVSS Score:** 8.1 (HIGH)
**Detection Status:** ❌ NOT DETECTED (current scanner)
**Phase 2 Detection:** ✅ DETECTED (sleeper-agent-timer rule)

This example demonstrates malicious code examples that will be blocked by Phase 2 scanner enhancements.

---

**END PREVIEW - FULL DOCUMENT AVAILABLE AT:**
`/home/urbnpl4nn3r/dev/moltbot/.security-hardening/07-threat-model-phase2.md` (Section 2 - Attack Vectors)

For detailed attack flows and code examples, see the comprehensive threat model document.

---

**Document Owner:** Pablo's Security Team
**Review Status:** ✅ COMPLETE
**Next Review:** 2026-03-10 (30 days post-implementation)
