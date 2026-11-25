"use client";

import { useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useClerk } from "@clerk/nextjs";
import { ChevronsUpDown, Check, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface OrgItem {
  id: string;
  name: string;
  role: string;
  clerkOrgId: string | null;
}

export function OrgSwitcher({ orgs, activeOrganizationId }: {
  orgs: OrgItem[];
  activeOrganizationId: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const clerk = useClerk();
  const { setActive } = clerk;
  const [open, setOpen] = useState(false);
  const [pendingName, setPendingName] = useState("");
  const [switching, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const inFlight = useRef(false);
  const current = orgs.find((org) => org.id === activeOrganizationId);
  const busy = switching || createBusy;

  const activateOrganization = async (organizationId: string, clerkOrgId: string | null, role: string) => {
    try {
      if (!clerkOrgId) throw new Error("Organization is not linked to Clerk yet.");
      await setActive({ organization: clerkOrgId });
      if (clerk.organization?.id !== clerkOrgId) throw new Error("Clerk did not activate the selected organization.");
    } catch (error) {
      if (role !== "OWNER") throw error;
      // Only the failed-activation path calls Clerk's Backend API. The server
      // verifies OWNER and repairs only missing setup / empty legacy orgs.
      const response = await fetch("/api/orgs/repair", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      const result = await response.json();
      if (!response.ok || !result.clerkOrgId) throw new Error(result.message ?? "Could not repair organization access.");
      // Backend-added membership must also be visible to Clerk's client.
      await clerk.user?.reload();
      await setActive({ organization: result.clerkOrgId });
      if (clerk.organization?.id !== result.clerkOrgId) throw new Error("Clerk did not activate the selected organization.");
    }
  };

  const restoreActiveOrganization = async () => {
    if (!activeOrganizationId) return;
    try {
      const rollback = await fetch("/api/orgs/switch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: activeOrganizationId }),
      });
      if (!rollback.ok) throw new Error("Rollback failed");
    } catch {
      toast.error("Organization state could not be restored. Reload before continuing.");
      router.refresh();
    }
  };

  const handleSwitch = (org: OrgItem) => {
    if (inFlight.current || switching) return;
    setOpen(false);
    if (org.id === activeOrganizationId && org.clerkOrgId && org.clerkOrgId === clerk.organization?.id) return;
    inFlight.current = true;
    setPendingName(org.name);
    startTransition(async () => {
      let persisted = false;
      try {
        const response = await fetch("/api/orgs/switch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ organizationId: org.id }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "Could not switch organization.");
        persisted = true;
        await activateOrganization(org.id, result.clerkOrgId, org.role);
        // Clerk's Next.js provider refreshes the router after setActive.
        // A second refresh here duplicates the server render and DB reads.
        // A project editor belongs to its original org; leave it on a switch.
        if (pathname === "/workspace") router.push("/projects");
      } catch (error) {
        // Roll back the app pointer if Clerk activation failed, so app and
        // project authorization don't silently use different organizations.
        if (persisted) await restoreActiveOrganization();
        toast.error(error instanceof Error ? error.message : "Could not switch organization.");
      } finally {
        inFlight.current = false;
      }
    });
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || createBusy || inFlight.current) return;
    inFlight.current = true;
    setCreateBusy(true);
    let created = false;
    try {
      const response = await fetch("/api/orgs/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.message ?? "Could not create organization.");
      created = true;
      await activateOrganization(result.organizationId, result.clerkOrgId, "OWNER");
      setOpen(false);
      setCreating(false);
      setNewName("");
      toast.success(`Created ${name}.`);
      // New orgs start empty; don't strand the user in another org's editor.
      // setActive already refreshes the route on success.
      if (pathname === "/workspace") router.push("/projects");
    } catch (error) {
      if (created) await restoreActiveOrganization();
      toast.error(created
        ? `Organization created, but could not activate it: ${error instanceof Error ? error.message : "Please try selecting it again."}`
        : error instanceof Error ? error.message : "Could not create organization.");
      // Show any saved org so setup can be retried without creating a duplicate.
      router.refresh();
    } finally {
      inFlight.current = false;
      setCreateBusy(false);
    }
  };

  const label = switching ? `Switching to ${pendingName}…` : current?.name ?? "Organization";

  return (
    <div className="relative min-w-0 max-w-36 flex-1 sm:max-w-48">
      <DropdownMenu open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
        <DropdownMenuTrigger
          disabled={busy}
          aria-busy={switching}
          className="flex h-11 w-full min-w-0 items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 text-left text-sm text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-wait"
        >
          <span className="sr-only">Organization: </span>
          <span className="truncate">{label}</span>
          {switching
            ? <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
            : <ChevronsUpDown className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={8}
          className="w-72! max-w-[calc(100vw-1rem)] p-1"
        >
          {orgs.map((org) => (
            <DropdownMenuItem
              key={org.id}
              disabled={busy}
              onClick={() => handleSwitch(org)}
              aria-current={org.id === activeOrganizationId ? "true" : undefined}
              className="min-h-11 items-center px-3"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{org.name}</span>
                <span className="block text-xs capitalize text-muted-foreground">{org.role.toLowerCase()}</span>
              </span>
              {org.id === activeOrganizationId && <Check className="size-4 shrink-0 text-violet-600 dark:text-violet-400" aria-hidden="true" />}
            </DropdownMenuItem>
          ))}
          <div className="border-t border-border p-2">
            {creating ? (
              <div className="space-y-2 px-1 py-1">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape" || e.key === "Tab") return;
                    e.stopPropagation();
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void handleCreate();
                    }
                  }}
                  placeholder="Organization name"
                  maxLength={60}
                  aria-label="New organization name"
                  className="h-11 w-full rounded-lg border border-border bg-background px-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
                />
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setCreating(false);
                      setNewName("");
                    }}
                    disabled={createBusy}
                    className="inline-flex h-11 items-center rounded-full px-3 text-sm text-foreground hover:bg-muted disabled:opacity-40"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={createBusy || !newName.trim()}
                    className="inline-flex h-11 items-center rounded-full bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
                  >
                    {createBusy ? "Creating…" : "Create"}
                  </button>
                </div>
              </div>
            ) : (
              <DropdownMenuItem
                closeOnClick={false}
                disabled={busy}
                onClick={() => setCreating(true)}
                className="min-h-11 px-3 text-sm font-medium"
              >
                <Plus className="size-4" aria-hidden="true" />
                New organization
              </DropdownMenuItem>
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
