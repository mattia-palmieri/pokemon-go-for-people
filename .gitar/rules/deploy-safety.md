---
title: "Deploy safety"
description: "Keep the hardened Kubernetes settings when deploy/ changes"
type: check
when: "PRs that change files under deploy/"
actions: "Post a comment listing any setting below that the PR removes or weakens, with the file and line"
---

# Deploy safety

These settings fixed Radar's Checks (4 → 0) and must stay:
- `automountServiceAccountToken: false` on the app pod.
- `readOnlyRootFilesystem: true`, with an `emptyDir` mounted at `/tmp`.
- CPU and memory requests and limits on every container (the team budget is 2 CPU / 4 GiB of requests).
- The PodDisruptionBudget (`minAvailable: 1`) and the hostname topology spread.
- No privileged, hostPath, hostNetwork or hostPID pods (the host refuses them).
- Secrets come from `secretKeyRef`, never as literal values.
