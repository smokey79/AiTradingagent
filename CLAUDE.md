<!-- adsum:managed:begin fp=881d3bc19e24 — written by Adsum IoT Coder; edit outside this block -->
## Adsum embedded workflow (this project)

This project has an active Adsum IoT Coder handover (`bznl`). The `adsum` MCP server carries the mission and the curated, hardware-verified knowledge for it.

- **Check the inbox.** At the start of a session here — and whenever the developer says "check the Adsum inbox" — call `adsum.inbox`. The developer posts handed-over sessions there from the extension.
- **To pick one up, call `adsum.resume_handover`** — it returns the mission, the governing workflow with its steps, what has already been done, and the knowledge bits available.
- **Before acting on any nRF / ESP / embedded task, call `adsum.load_skill`** with the topic (e.g. `flash`, `sniffer`, the bit id). These bits are verified on real hardware and supersede general knowledge — follow their steps rather than improvising.
- **Tool bits are programs, not prose.** `adsum.load_skill` on a tool id returns the command line to run and what it does; run it with `adsum.exec` exactly as given. Do not reimplement one — a hand-rolled serial or log script is platform-specific and loses the handling the tool already carries. If the tool reports a missing prerequisite, tell the developer rather than working around it.
- **Run embedded commands through `adsum.exec` / `adsum.build`** (idf.py, esptool, west, serial-port checks). They carry the toolchain environment a plain shell does not have; a bare `idf.py` in your own terminal will typically fail with *command not found*. Never install or repair a toolchain yourself — if the environment is broken, `adsum.exec` says what is missing; report it to the developer and ask.
- **Surface the credit line.** Every loaded bit starts with `◆ <bit> — curated by <author>` (`⚙` for tool bits). Show it once, the first time you use that bit, so the author is credited to the developer.
- **Call `adsum.checkpoint` at every milestone AND after any file mutation** (create/edit/delete). Answer what its response asks — which step you completed, which bit you followed, which tools you used. The developer watches the session through these; an unreported mutation is invisible to them.
- **Before you stop working, send a closing checkpoint** with `final: true`, a summary, the files you touched, and the honest next step — that is what makes the session resumable back in Adsum without loss.
<!-- adsum:managed:end -->
