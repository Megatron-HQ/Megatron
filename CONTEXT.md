# Megatron

A local-first desktop app that inventories, lints, and tracks usage of every Claude Code skill a user has. Read-only in v1: it discovers and describes state, it never writes to `~/.claude`.

## Language

### Skills

**Skill**:
A named, self-contained capability Claude Code can invoke, identified by a `SKILL.md` file's frontmatter (name + description). Static — describes what exists on disk, not whether or how often it's been used. See Skill Invocation for the usage-event counterpart.
_Avoid_: Capability, tool

**Skill Source**:
Which of the three places a Skill lives: Global, Project, or Plugin. Determines discoverability and whether the Skill is user-editable (Plugin Skills aren't — they're silently overwritten on update).
_Avoid_: Tier, kind, type — "tier" specifically collides with Permission Tier below; use Skill Source for this axis

**Permission Tier**:
Which trust bucket governs whether Megatron may read a path without asking: **Tier 1** (auto-trusted at launch — covers both the Global and Plugin Skill Sources) or **Tier 2** (requires explicit user consent via the onboarding picker — covers only the Project Skill Source). Deliberately not the same grouping as Skill Source: Global and Plugin are different Sources but the same Tier.
_Avoid_: Skill Source — a Tier is a permission bucket, not a place a Skill lives; the two happen to overlap but aren't interchangeable

**Grant** (verb) / **Granted Path** (noun):
A user consenting, via the onboarding picker, to let Megatron read one specific repo folder for Project-Source Skills — and the resulting allow-listed path itself. Only meaningful for Tier 2; Tier 1 paths are never granted, only auto-trusted.
_Avoid_: Permission (too generic — Grant is the specific consent action that produces one)

### Scanning

**Scan**:
The read-only pass that walks every trusted or granted path across the three Skill Sources and reconciles the Index to match what's currently on disk — adding Skills that appeared, removing ones that vanished. Discovers what exists; does not judge it.
_Avoid_: Sync (implies bidirectional — Megatron never writes back), Index (that's the destination of a Scan, not the act)

**Index**:
The local database a Scan writes into — Megatron's own regenerable record of what Skills, Sessions, and Skill Invocations exist. Never a source of truth in its own right; deleting it and rescanning is always safe and lossless for anything still on disk.
_Avoid_: Database, cache

### Usage tracking

**Session**:
One Claude Code working conversation — has its own session id, a working directory, and optionally a git branch. The unit a Skill Invocation belongs to.
_Avoid_: Conversation, chat

**Transcript**:
The on-disk record of a Session's turns, owned and formatted by Claude Code itself. Megatron reads it to derive Sessions and Skill Invocations; never edits it.
_Avoid_: Log, history

**Skill Invocation**:
One recorded event of a Skill being called during a Session. Distinct from the Skill itself: a Skill is static and either exists or doesn't; an Invocation is a historical fact — it happened once, at a specific time, in a specific Session — and is immutable once recorded.
_Avoid_: Call, usage, run

**Trigger Type**:
Whether a Skill Invocation was **User-Invoked** (the user's own words named the skill) or **Autonomous** (the model chose to invoke it unprompted, matching context to the Skill's description). A property of the Invocation, never of the Skill itself — the same Skill can be triggered either way on different occasions.
_Avoid_: Manual/automatic, explicit/implicit

### Plugins

**Plugin**:
A Skill Source bundled and versioned by a Marketplace, installed read-only. Identified by the pair of its name _and_ its Marketplace — the same plugin name can be published by more than one Marketplace, and those are different Plugins.
_Avoid_: Extension, package

**Marketplace**:
The named registry a Plugin was installed from. Not itself a Skill Source — it's the thing a Plugin's identity, and its update/report path, resolve through.
_Avoid_: Registry, repo — see Marketplace Repo, which is a different, resolved fact about a Marketplace

**Marketplace Repo**:
The specific GitHub repository a Marketplace points to. Resolved independently of Plugin installation records; the deep-link target when a user wants to report a Plugin issue.
_Avoid_: Marketplace (the Marketplace is the named registry; the Repo is one resolved fact about it, and can be absent even when the Marketplace isn't)

### Linting

**Lint Finding**:
One deterministic, rule-tagged problem surfaced about a single Skill — e.g. missing frontmatter, a dead file-path reference, a name collision with another Skill. Always produced by re-reading the Skill fresh, never by trusting what a Scan cached.
_Avoid_: Warning, issue
