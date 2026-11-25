# Workspace, preview, and exports

## Phone, tablet, and desktop

The landing page, project list, and settings dialogs work on narrow screens. The workspace editor needs a browser viewport at least **768 pixels wide and 500 pixels tall**. On a smaller window, homepage **Generate** explains the limit rather than opening the editor or starting a build. Opening a workspace directly shows **Desktop Required** without mounting the editor.

A homepage build uses a matching, one-use launch intent in the same browser tab. A blocked window does not consume that intent. If you widen the same tab and the original prompt and selection still match, the build can start once. The workspace URL alone does not authorize an automatic build.

If you resize below the limit during an active run, the blocker shows its status and a **Stop run** button. Stop cancels the request. It does not undo a save that has already finished or guarantee a refund from the provider.

## Chat drafts

Drevo keeps unsent prompts and edits in the current browser tab when session storage is available. Drafts are scoped to your account, organization, and workspace or homepage launch. A failed send leaves the prompt available to revise or resend, and chat shows an error. Drafts are not synced across tabs or devices.

## Preview and code

Sandpack starts after saved project files are available, so a first build that produces only `/App.js` starts with the generated app rather than a placeholder. **Code** is read-only; ask for changes in chat. If the preview is stuck, use **Refresh preview** before sending another prompt. If Sandpack reports a project error, **Fix with AI** starts another run using the selected provider.

## ZIP and GitHub

- **Download** creates a ZIP from the project files currently loaded in your browser. If it fails, Drevo shows an error.
- **GitHub** reads the latest saved workspace files from the database. If another member saved changes since you opened the workspace, the push can differ from the ZIP in your tab.
- Both use the same export file builder. Neither action starts an AI run. See [GitHub integration](./07-github-integration.md) for setup and push behavior.
