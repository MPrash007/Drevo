"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface Member {
  id: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  user: { id: string; name: string; email: string; imageUrl: string };
  isSelf: boolean;
}

const field = "h-11 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring";

export function MembersDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [myRole, setMyRole] = useState<string>("MEMBER");
  const [orgId, setOrgId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"MEMBER" | "ADMIN">("MEMBER");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [confirm, setConfirm] = useState<{
    memberId: string;
    isSelf: boolean;
    name: string;
    email: string;
  } | null>(null);
  const [removing, setRemoving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePhrase, setDeletePhrase] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoadError("");
    try {
      const res = await fetch("/api/orgs/members");
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setLoadError(d?.message ?? "Could not load members.");
        return;
      }
      setMembers(d.members ?? []);
      setMyRole(d.role ?? "MEMBER");
      setOrgId(d.organizationId ?? null);
      setLoaded(true);
    } catch {
      setLoadError("Could not load members. Check your connection and try again.");
    }
  };

  const canManage = myRole === "OWNER" || myRole === "ADMIN";

  const handleDeleteOrg = async () => {
    if (deletePhrase !== "DELETE" || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const res = await fetch("/api/orgs/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: orgId }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        const message = d?.message ?? "Could not delete organization.";
        setDeleteError(message);
        toast.error(message);
        return;
      }
      toast.success("Organization deleted.");
      setDeleteOpen(false);
      setDeletePhrase("");
      setOpen(false);
      router.refresh();
    } catch {
      const message = "Could not delete organization. Check your connection and try again.";
      setDeleteError(message);
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  };

  const handleAdd = async () => {
    if (!email.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/orgs/members/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Clerk sends the invitation email; membership lands via webhook.
        body: JSON.stringify({ email: email.trim(), role: inviteRole }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        const src = d?.source === "clerk" ? " (Clerk refused)" : "";
        toast.error(`${d?.message ?? "Could not send invite."}${src}`);
        return;
      }
      toast.success("Invitation sent via Clerk.");
      setEmail("");
      await load();
      router.refresh();
    } catch {
      toast.error("Could not send invite. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleSync = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/orgs/sync", { method: "POST" });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(d?.message ?? "Sync failed.");
        return;
      }
      if (d?.added > 0) toast.success(`Synced ${d.added} new member${d.added !== 1 ? "s" : ""}.`);
      else toast.info("Already in sync with Clerk.");
      await load();
      router.refresh();
    } catch {
      toast.error("Sync failed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleRole = async (memberId: string, role: string) => {
    try {
      const res = await fetch("/api/orgs/members/role", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, role }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(d?.message ?? "Could not update role.");
        return;
      }
      toast.success("Role updated.");
      await load();
    } catch {
      toast.error("Could not update role. Check your connection and try again.");
    }
  };

  const doRemove = async () => {
    if (!confirm || removing) return;
    setRemoving(true);
    try {
      const res = await fetch("/api/orgs/members/remove", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: confirm.memberId }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(d?.message ?? "Could not remove member.");
        return;
      }
      const wasSelf = confirm.isSelf;
      setConfirm(null);
      toast.success(wasSelf || d?.selfRemoved ? "You left the organization." : "Member removed.");
      if (d?.selfRemoved || wasSelf) {
        setOpen(false);
        router.refresh();
        return;
      }
      await load();
      router.refresh();
    } catch {
      toast.error("Could not remove member. Check your connection and try again.");
    } finally {
      setRemoving(false);
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen);
      if (nextOpen) void load();
    }}>
      <DialogTrigger
        aria-label="Organization members"
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Users className="size-4" aria-hidden="true" />
      </DialogTrigger>
      <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-md">
        <DialogHeader className="pr-12">
          <DialogTitle className="text-base font-semibold text-foreground">
            Organization members
          </DialogTitle>
          <DialogDescription>
            People who can open this workspace. Invitations are sent by Clerk.
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleSync()}
            disabled={busy}
            aria-busy={busy}
            className="min-h-11 sm:min-h-9"
          >
            Sync members
          </Button>
        </div>

        {canManage && (
          <div className="flex flex-col gap-2">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleAdd();
                }
              }}
              placeholder="teammate@company.com"
              aria-label="Invite email address"
              inputMode="email"
              autoComplete="email"
              className={field}
            />
            <div className="flex gap-2">
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as "MEMBER" | "ADMIN")}
                aria-label="Invite role"
                className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-base text-foreground"
              >
                <option value="MEMBER">Member</option>
                <option value="ADMIN">Admin</option>
              </select>
              <Button type="button" onClick={() => void handleAdd()} disabled={busy || !email.trim()} aria-busy={busy} className="h-11 min-h-11 shrink-0 px-4">
                Invite
              </Button>
            </div>
          </div>
        )}

        {loadError && (
          <div role="alert" className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-3">
            <p className="text-sm text-destructive">{loadError}</p>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        )}

        <div className="max-h-80 space-y-1 overflow-y-auto">
          {!loaded && !loadError && (
            <p role="status" className="py-6 text-center text-sm text-muted-foreground">Loading members…</p>
          )}
          {members.map((m) => {
            const name = m.user.name || m.user.email;
            return (
              <div key={m.id} className="flex flex-col gap-2 rounded-lg px-2 py-2 hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {name}
                    {m.isSelf && <span className="ml-1 font-normal text-muted-foreground">(you)</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{m.user.email}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {canManage && !m.isSelf && m.role !== "OWNER" ? (
                    <select
                      value={m.role}
                      onChange={(e) => void handleRole(m.id, e.target.value)}
                      aria-label={`Role for ${name}`}
                      className="h-11 rounded-md border border-border bg-background px-2 text-base text-foreground sm:h-9 sm:text-sm"
                    >
                      <option value="MEMBER">Member</option>
                      <option value="ADMIN">Admin</option>
                    </select>
                  ) : (
                    <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
                      {m.role}
                    </span>
                  )}
                  {(canManage || m.isSelf) && (
                    <button
                      type="button"
                      onClick={() =>
                        setConfirm({
                          memberId: m.id,
                          isSelf: m.isSelf,
                          name,
                          email: m.user.email,
                        })
                      }
                      aria-label={m.isSelf ? "Leave organization" : `Remove ${name}`}
                      className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      {m.isSelf ? "Leave" : "Remove"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {loaded && !loadError && members.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">No members yet.</p>
          )}
        </div>

        {myRole === "OWNER" && orgId && (
          <div className="border-t border-border pt-3">
            <button
              type="button"
              onClick={() => {
                setDeleteError("");
                setDeletePhrase("");
                setDeleteOpen(true);
              }}
              className="min-h-11 w-full rounded-lg px-3 py-2 text-center text-sm font-medium text-destructive hover:bg-destructive/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Delete organization and all its projects
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>

    <Dialog
      open={confirm !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !removing) setConfirm(null);
      }}
    >
      <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-sm">
        <DialogHeader className="pr-12">
          <DialogTitle className="text-base font-semibold text-foreground">
            {confirm?.isSelf ? "Leave organization?" : "Remove member?"}
          </DialogTitle>
          <DialogDescription className="text-sm break-words text-muted-foreground">
            {confirm?.isSelf
              ? "You will lose access to this organization's projects."
              : `${confirm?.name} (${confirm?.email}) will lose access to this organization's projects.`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => setConfirm(null)}
            disabled={removing}
            className="min-h-11 sm:min-h-9"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void doRemove()}
            disabled={removing}
            className="min-h-11 sm:min-h-9"
          >
            {removing ? "Removing…" : confirm?.isSelf ? "Leave" : "Remove"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog
      open={deleteOpen}
      onOpenChange={(nextOpen) => {
        if (deleting) return;
        setDeleteOpen(nextOpen);
        if (!nextOpen) {
          setDeletePhrase("");
          setDeleteError("");
        }
      }}
    >
      <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-sm">
        <DialogHeader className="pr-12">
          <DialogTitle className="text-base font-semibold text-foreground">
            Delete organization?
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            This permanently deletes the organization and all its projects. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <label className="block space-y-1.5 text-sm font-medium text-foreground">
          Type DELETE to confirm
          <input
            value={deletePhrase}
            onChange={(e) => setDeletePhrase(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className={field}
          />
        </label>
        {deleteError && <p role="alert" className="text-sm text-destructive">{deleteError}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => setDeleteOpen(false)}
            disabled={deleting}
            className="min-h-11 sm:min-h-9"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void handleDeleteOrg()}
            disabled={deleting || deletePhrase !== "DELETE"}
            className="min-h-11 sm:min-h-9"
          >
            {deleting ? "Deleting…" : "Delete organization"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
