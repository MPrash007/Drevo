# Drevo

Drevo turns a prompt into a React app with a live Sandpack preview. Build and edit with your own AI connection, restore project versions, download a ZIP, or push the saved source to GitHub.

Drevo has no plans, payments, credits, or built-in model keys. OpenAI, xAI, Groq, OpenRouter, and Google Gemini are supported through their OpenAI-compatible APIs; the selected provider account pays for its usage.

The workspace editor requires a browser window at least **768 px wide and 500 px tall**. You can browse the project list on your phone, but Drevo won’t start a build from a window that’s too small. See [workspace, preview, and exports](docs/13-workspace-ui.md).

## Local setup

1. Use Node.js 24 LTS. Install with `pnpm install --frozen-lockfile`. The postinstall script generates Prisma Client.
2. Set up a dedicated development PostgreSQL database (`DATABASE_URL`, `DIRECT_URL`) and Clerk application (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `CLERK_WEBHOOK_SECRET` for signed organization webhooks). Configure `ARCJET_KEY` for request protection.
3. Set `AI_PROVIDER_ENCRYPTION_KEY` to 32 random bytes encoded as 64 hex characters. Generate it with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Store it securely and keep it stable across deployments. Loss or replacement requires users to reconnect their provider keys.
4. Apply reviewed migrations **to the development database** with `pnpm exec prisma migrate deploy`, then start `pnpm dev`.
5. Open a workspace, select **AI providers**, and test and save a connection. Review the account shown beside the composer before sending your first prompt.

Optional integrations: [private Supabase image attachments](docs/12-ai-providers.md#private-attachments) and [GitHub OAuth setup](docs/07-github-integration.md) for pushes.

## Verified behavior and rollout

Run `pnpm test`, `pnpm exec tsc --noEmit --incremental false`, `pnpm exec prisma validate`, and `pnpm build`. Run TypeScript separately from the Next.js build, which regenerates `.next/types`.

The provider migration is additive and leaves existing projects, memberships, history, and legacy billing records intact. Existing organizations initially disallow personal keys; owners can enable them. New automatically provisioned starter workspaces enable them. The database did not historically record a reliable starter/team distinction for existing organizations, so the upgrade does not guess.

Before deploying over a billing-enabled installation, review and resolve active subscriptions in Clerk and remove obsolete billing webhook subscriptions. Installing or migrating Drevo does **not** cancel external subscriptions. No deployment should run without a backup and a staging migration check.

See [AI providers and organization policy](docs/12-ai-providers.md), the [documentation index](docs/README.md), and [AGENTS.md](AGENTS.md) for project decisions.
