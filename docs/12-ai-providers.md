# AI providers and organization policy

Beside the homepage or workspace prompt, open **AI providers**, choose OpenAI, xAI, Groq, OpenRouter, or Google Gemini, enter a suggested or custom model ID, and select **Test and save**. The check sends a synthetic prompt with one small tool call, not your project. It may incur a provider charge. Suggested models are starting points; provider availability and model access depend on the account. For Google Gemini, use a [Google AI Studio API key](https://aistudio.google.com/apikey).

If the picker reports a missing database migration, confirm the development database in your Prisma config and run `pnpm exec prisma migrate deploy` against it before retrying. If the dev server still uses an older generated Prisma Client, run `pnpm exec prisma generate` and restart it.

You can keep one private connection per provider, each with its own API key and saved model. In **AI providers**, select **Add personal provider** to connect another one without replacing existing connections. **Use in this project** switches the active provider. Disconnecting or replacing one provider leaves the others alone.

On an unpinned project, Drevo defaults to your personal connection when the organization allows it and exactly one is connected. If several are connected, choose which account to use. If none are connected and personal keys are allowed, connect yours or explicitly choose the shared organization connection. If personal keys are disallowed, only the shared connection can be used.

Owners and admins can manage one shared provider/key/model. Members can use it but cannot read the key. Only owners can change the organization's personal-key policy. New starter workspaces allow personal keys; other organizations start with them disabled.

Drevo remembers one model and connection scope per member and project. The composer shows the model and paying account. A same-model key rotation is transparent. Removing or replacing the pinned model stops runs until the member picks a replacement. There is no automatic provider fallback.

The homepage and editor both check [workspace window requirements](./13-workspace-ui.md#phone-tablet-and-desktop) before starting a build. The **Test and save** connection check is a separate action.

## Implementation

- `app/api/ai/providers/route.ts`: membership-scoped metadata reads, role-gated mutations, streamed connection check and explicit project selection.
- `lib/ai-provider-server.ts`: fixed endpoints, credential validation and AES-256-GCM encryption. Encrypted keys are bound to the connection's owner, provider and model. Never return raw provider errors or keys to the browser. The existing `User.aiProviderConfig` field supports both the old single connection and the new list; no database migration or key re-entry is needed. Older releases cannot read the list, so don't roll back while it is in use.
- `app/api/improve/route.ts`: single streamed tool loop for first builds, edits and Fix with AI. Existing workspace files are loaded from PostgreSQL. The route checks membership, revision, organization policy, and the pinned model before making an external call.
- `lib/workspace-save.ts`: saves generated files, revision and previous-version history transactionally. No AI credit operations. Existing billing columns and migrations are historical records only.
- Generated projects are linked with an in-memory browser bundle before saving. Missing local exports and undeclared packages are rejected, and requested npm versions/ranges/tags are resolved to published versions and pinned. This does not install packages, check exports from external packages, or run the generated app.

## Private attachments

For new workspace image uploads, create a **private** Supabase bucket named `drevo-private-attachments`. Do not grant anonymous or browser-client access to this bucket. Set `NEXT_PUBLIC_SUPABASE_URL` and the **server-only** `SUPABASE_SERVICE_ROLE_KEY` for that instance. Drevo checks Clerk organization membership on upload and download and refuses a public bucket. Images are limited to 4 MB and PNG, JPEG, GIF, or WebP.

New attachments appear in workspace chat. Their URLs and pixels are not sent to model providers or embedded in generated apps. Describe private images in your prompt if the model needs context. Legacy links to the old `workspace-images` bucket are not migrated or made private by this change; review that bucket and move or remove any sensitive legacy objects as appropriate.

## Production checklist

Set the encryption key in the hosting secret manager, review and apply the additive migration in a test environment, and verify first build/edit/restore, same-model key rotation, replacement, and owner/member policy using test-only provider keys. Open models with a small quota or budget. Never include real keys in test fixtures, logs, prompts, generated files or exports.
