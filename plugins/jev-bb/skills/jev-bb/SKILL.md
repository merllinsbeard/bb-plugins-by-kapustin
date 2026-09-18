---
name: jev-bb
description: Use Jev Eco Mode for initial exploration of non-sensitive workspace files with smaller context reads.
---

Check `bb jev status`. When Eco Mode is enabled, prefer `jev_read` or `bb jev read <relative-path> --task "specific question" [--start N] [--end N]` for initial source exploration. Never enable sharing on the user's behalf; they enable it with the thread toggle. `bb jev off` disables it.

The requested source range and task are sent to Typesafe. Never send secrets, personal information, or confidential files. Credential detection is a precaution, not a guarantee. Do not encode or rename files to bypass exclusions.

Selected excerpts retain original line numbers. Omitted ranges are incomplete evidence: use normal file tools to inspect them before edits or claims about absence. Errors return the original range. This does not compact conversation history. Counters are source characters, not token savings. Changes to instructions take effect on the next provider session; runtime reads check the current toggle.
