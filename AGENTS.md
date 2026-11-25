<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Drevo project decisions

- Drevo is a Next.js app that generates React/Sandpack projects. Preserve workspace data, revision checks, history, and GitHub export when changing the AI workflow.
- The open-source app has no Drevo billing, credits, or built-in AI credentials. A single OpenAI-compatible tool loop handles initial builds, edits, and Fix with AI. External providers charge their own accounts.
- Fixed provider endpoints only: OpenAI, xAI, Groq, OpenRouter, Google Gemini. Never accept a user-provided API URL, expose stored keys, or log raw provider errors. A manual model ID must pass a streamed tool-call check with synthetic input.
- Each user can configure one private key and model per supported provider. An organization has one shared connection managed by owners/admins; only owners control whether personal keys are allowed. Personal keys default on in provisioned starter workspaces, off in team organizations.
- Default to the only connected personal provider when policy allows; with several personal providers, require an explicit choice for an unpinned project. Remember connection scope/provider/model per user and project. No silent fallback. A changed or removed model requires confirmation; key rotation for the same model does not.
- Never run migrations, replay webhooks, cancel plans, or exercise provider keys against live services as a local test. Disabling Drevo billing does not cancel existing Clerk subscriptions.
- Provider settings are available beside both prompt composers. Only non-secret selection metadata passes from the homepage to a new workspace. If the picker cannot load after an upgrade, check Prisma Client freshness and whether the provider migration is applied; never log provider keys.
- A homepage Generate action starts the first build only with a matching, one-use launch intent in the same browser tab. A workspace URL alone never authorizes a provider charge.
- The workspace is desktop-only. Use the shared viewport guard for both homepage Generate and workspace runs. A blocked viewport must not mount the editor, consume a launch intent, or start a provider run. Keep Stop visible if the window becomes too small during an active run.
- AI tool arguments and SSE are not proof that generated code compiles. Parse generated JS/JSX and JSON, check the entry export and static local imports before saving, and return syntax failures to the selected model within the same run. Keep broken legacy projects loadable for repair.
- Link new AI revisions with the in-memory browser bundle validator before save; do not execute generated code or install generated dependencies on the server. Resolve model-requested npm versions/ranges/tags against the registry, never accept arbitrary package sources, and reject project-path collisions in validation and export.
- New chat images use the private `drevo-private-attachments` bucket through a membership-checked API. Never send private attachment URLs to providers. Legacy public objects need explicit operator remediation.
