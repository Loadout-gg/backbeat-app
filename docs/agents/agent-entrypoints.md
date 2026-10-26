# Agent entry points: one policy, several discovery paths

The canonical project instructions are [AGENTS.md](../../AGENTS.md), with the [development guide](README.md) and [architectural gate](architecture-decisions.md). Keep policy in those files, not in vendor-specific copies. A task's model name is not enough to identify its runner or loading behavior.

## Discovery coverage

Public documentation was checked on 2026-10-26. The rows describe documented mechanisms, not a test on Simone's machine or universal enforcement.

| Agent surface | Project entry | What is established / limitation |
|---|---|---|
| Codex | Root AGENTS.md | Documented project discovery; overrides, working directory and context limits still matter |
| Cursor Agent | Root AGENTS.md | Documented root/subdirectory support; this is not a claim about Cursor Tab or every AI feature |
| Claude Code | Root CLAUDE.md importing AGENTS.md | Current versions also support native AGENTS.md under documented conditions. The one-line import supports sessions that use CLAUDE.md without copying policy. Settings/exclusions/managed-only contexts can still affect loading |
| GitHub Copilot supported repository/agent surfaces | AGENTS.md plus .github/copilot-instructions.md | Agent instructions and repository-wide instructions have surface-dependent support. The bridge's Markdown reference is an instruction to read the canonical file, not a claim of an automatic import processor |
| Gemini CLI's documented context mechanism | Root GEMINI.md importing AGENTS.md | The documented @file syntax includes the shared policy; context filename/settings can vary. The cited site flags a transition to Antigravity CLI for some users. This row does NOT certify Antigravity or every Gemini-branded product |
| Other/custom agents | Explicit bootstrap below | Must have access to the repository or receive the policy through the supported context mechanism. No filename can force every arbitrary agent to read or obey it |

The bridges are plain files, not symlinks, global configuration, hooks or duplicated policies. Do not run /init or copy vendor-generated instructions over the approved AGENTS.md. Do not alter client settings, tool permissions or repository protections without their own authorization.

## Universal task bootstrap

Provide this at task start when automatic discovery is unavailable or unproven:

```text
Before making changes, read the repository-root AGENTS.md and every required guide it links to. Report the actual branch/HEAD, the instruction paths read, and the task's architecture classification. Follow the recorded Alberto approval boundary. If a required instruction file is inaccessible, stop and identify the missing context rather than inventing rules. Do not claim loading or verification without evidence. Then perform only the authorized task.
```

This bootstrap points to the policy; it does not replace it. For an agent without repository-file tools, supply the exact approved policy and required context through its actual supported input mechanism before asking it to implement. A URL or a local path alone is not proof that the content was read.

## Loading verification in the actual runner

1. Start a fresh task from the intended checkout. Record the runner/version, repository revision and relevant project settings without exposing credentials.
2. Inspect the runner's loaded-context evidence when available. Claude documents `/context` and `/memory`; Gemini CLI documents `/memory show`; GitHub Copilot Chat can list the custom instruction file in response references. Confirm the canonical content, not just a bridge filename. Follow the runner's current documentation if commands change.
3. As a read-only probe, ask the agent to cite the owner rule and classify an ordinary UI correction versus an unapproved validator/Auth/database change. This is a classification exercise, not authorization to implement or open a real request. Missing or contradictory rules fail the probe.
4. Keep loaded-context evidence separate from observed compliance. An answer repeating the rule does not guarantee future behavior. An actual architecture-changing task must still produce the exact stop line and concurrent decision package specified in the canonical gate.
5. Scope any pass to the tested runner/version/checkout/settings. A result from a local agent is not proof of Simone's sessions. Repeat relevant checks when loading configuration changes.

Do not call an AI-guidance file a security boundary. Human review, constrained write permissions and separately approved repository controls remain distinct.

## Official references

- Claude Code memory and imports: https://code.claude.com/docs/en/memory
- Codex AGENTS.md discovery: https://developers.openai.com/codex/guides/agents-md (retrieval redirected to the current ChatGPT Learn documentation)
- Cursor rules and AGENTS.md: https://cursor.com/docs/context/rules
- GitHub Copilot repository instructions: https://docs.github.com/en/copilot/customizing-copilot/adding-repository-custom-instructions-for-github-copilot
- Gemini CLI context and imports: https://geminicli.com/docs/cli/gemini-md/
