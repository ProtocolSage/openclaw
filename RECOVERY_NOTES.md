# RECOVERY_NOTES

Runbook: Split-and-Stabilize Locked v5
Checkpoint: c8646db9b
Recovery branch: recovery/p0-security-clean
Forensic branch: forensics/p0-partial-20260308

Locked replay SHAs:

- ca0eacba2
- 7151083f4
- d01794c01
- 7646b97fd
- 5f240e935
- c5d011376
- 1df33fd5c
- 51b0bfe5e
- 12fdcbb37
- 3fde97185
- 17e5d9d66

Conflict entry format:
<sha> | <file> | <choice upstream|local|manual> | <short rationale> | <timestamp>

CI result format:
<sha> | ci | <pass|fail> | <timestamp> | <ci-job-or-url>

Intent format:
<sha> | intent | <one-line security objective> | <timestamp>

Sign-off format:
signoff | <release-lead> | <security-owner> | <thread-or-pr-url> | <timestamp>

Quarantine format:
<sha> | quarantine | <branch-name> | <reason> | <timestamp>

Dry-run artifact format:
dryrun | <artifact-or-comment-url> | <summary> | <timestamp>
