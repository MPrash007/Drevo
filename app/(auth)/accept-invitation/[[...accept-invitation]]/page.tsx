"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SignIn, SignUp, useClerk, useUser } from "@clerk/nextjs";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Invitation = Awaited<
  ReturnType<NonNullable<ReturnType<typeof useUser>["user"]>["getOrganizationInvitations"]>
>["data"][number];

function errorMessage(error: unknown): string {
  const clerkError = error as { errors?: { longMessage?: string; message?: string }[] };
  return clerkError?.errors?.[0]?.longMessage || clerkError?.errors?.[0]?.message ||
    (error instanceof Error ? error.message : "Could not accept the invitation. Please try again.");
}

function Loading({ children = "Loading invitation..." }: { children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground" role="status">
      <Loader2 className="h-6 w-6 motion-safe:animate-spin" aria-hidden="true" />
      <p className="text-sm">{children}</p>
    </div>
  );
}

function AcceptInvitationContent() {
  const params = useSearchParams();
  const { isLoaded, user } = useUser();
  const { setActive, signOut } = useClerk();
  const organizationId = params.get("organization_id");
  const ticket = params.get("__clerk_ticket");
  const status = params.get("__clerk_status");
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const joining = useRef(false);

  // Authentication is owned entirely by Clerk's prebuilt components. Return
  // here afterwards, retaining the target org but not replaying a used ticket.
  const destination = organizationId
    ? `/accept-invitation?organization_id=${encodeURIComponent(organizationId)}`
    : "/accept-invitation";
  const authUrl = (flow: "sign_in" | "sign_up") => {
    const query = new URLSearchParams(params.toString());
    query.set("__clerk_status", flow);
    return `/accept-invitation?${query}`;
  };

  const join = useCallback(async (target: string, invitation?: Invitation) => {
    if (joining.current) return;
    joining.current = true;
    setLoading(true);
    setError(null);
    try {
      if (invitation) await invitation.accept();

      // Neither a query parameter nor a successful sign-in grants membership.
      // The server checks Clerk before writing the mirror and active org.
      const response = await fetch("/api/orgs/invitations/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clerkOrgId: target }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Could not verify organization membership.");
      await setActive({ organization: result.clerkOrgId });
      // Reload server data and the switcher's membership list together.
      window.location.replace("/projects");
    } catch (err) {
      setError(errorMessage(err));
      setLoading(false);
    } finally {
      joining.current = false;
    }
  }, [setActive]);

  useEffect(() => {
    if (!user || joining.current) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      const pending: Invitation[] = [];
      for (let page = 1; ; page++) {
        const result = await user!.getOrganizationInvitations({
          status: "pending", initialPage: page, pageSize: 100,
        });
        if (cancelled) return;
        pending.push(...result.data);
        if (organizationId && pending.some((invite) => invite.publicOrganizationData.id === organizationId)) break;
        if (result.data.length === 0 || pending.length >= result.total_count) break;
      }

      if (organizationId) {
        const invitation = pending.find((invite) => invite.publicOrganizationData.id === organizationId);
        // Clerk may have accepted the ticket during authentication already.
        // In that case, verify membership rather than accept a different invite.
        await join(organizationId, invitation);
      } else {
        // Older email links lack a target org. Ask the user to choose by name;
        // never guess by accepting the first pending invitation.
        setInvitations(pending);
        setLoading(false);
        if (pending.length === 0) {
          setError("This older link does not identify an organization and this account has no pending invitations. Ask the inviter for a new link, or open your existing projects if you already joined.");
        }
      }
    }

    void load().catch((err) => {
      if (!cancelled) {
        setError(errorMessage(err));
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [user, organizationId, attempt, join]);

  if (!isLoaded) return <Loading />;

  if (!user) {
    if (!ticket && !organizationId) {
      return (
        <section className="w-full max-w-md space-y-3 rounded-xl border border-border bg-card p-6 text-foreground">
          <h1 className="text-lg font-semibold">Invitation link needed</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Open the invitation link from your email to join an organization. This page cannot accept an invitation without that link.
          </p>
        </section>
      );
    }
    return status === "sign_up" ? (
      <SignUp
        routing="hash"
        forceRedirectUrl={destination}
        signInForceRedirectUrl={destination}
        signInUrl={authUrl("sign_in")}
      />
    ) : (
      <SignIn
        routing="hash"
        forceRedirectUrl={destination}
        signUpForceRedirectUrl={destination}
        signUpUrl={authUrl("sign_up")}
      />
    );
  }

  if (loading) return <Loading>Joining your organization...</Loading>;

  return (
    <section className="w-full max-w-md space-y-4 rounded-xl border border-border bg-card p-6 text-foreground">
      <h1 className="text-lg font-semibold">Organization invitation</h1>
      <p className="break-words text-sm text-muted-foreground">Signed in as {user.primaryEmailAddress?.emailAddress}</p>
      {error ? (
        <>
          <p role="alert" className="break-words text-sm text-destructive">{error}</p>
          <Button className="min-h-11" onClick={() => setAttempt((value) => value + 1)}>Try again</Button>
        </>
      ) : invitations.map((invitation) => (
        <div key={invitation.id} className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="min-w-0 break-words text-sm font-medium">{invitation.publicOrganizationData.name}</span>
          <Button
            className="min-h-11 w-full shrink-0 sm:w-auto"
            aria-label={`Join ${invitation.publicOrganizationData.name}`}
            onClick={() => void join(invitation.publicOrganizationData.id, invitation)}
          >
            Join
          </Button>
        </div>
      ))}
      <div className="flex flex-col gap-1 text-sm sm:flex-row sm:gap-4">
        <button type="button" className="inline-flex min-h-11 items-center underline underline-offset-4" onClick={() => void signOut({ redirectUrl: window.location.href })}>Use another account</button>
        <a href="/projects" className="inline-flex min-h-11 items-center underline underline-offset-4">View existing projects</a>
      </div>
    </section>
  );
}

export default function AcceptInvitationPage() {
  return <Suspense fallback={<Loading />}><AcceptInvitationContent /></Suspense>;
}
