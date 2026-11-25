import Link from "next/link";
import { UserButton, SignInButton, Show } from "@clerk/nextjs";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/LogoMark";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import { MembersDialog } from "@/components/MembersDialog";
import { checkUser } from "@/lib/checkUser";
import { ThemeToggle } from "@/components/ThemeToggle";

export default async function Header() {
  const user = await checkUser();

  const pick = user?.memberships.find((member) => member.organization.id === user.activeOrganizationId)
    ?? user?.memberships[0];
  const orgs = user?.memberships.map(({ organization, role }) => ({ ...organization, role })) ?? [];

  return (
    <header className="fixed top-0 right-0 left-0 z-50 h-16 border-b border-border bg-background text-foreground">
      <nav className="mx-auto flex h-full max-w-7xl items-center gap-1 px-2 sm:gap-3 sm:px-6">
        <Link href="/" className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" aria-label="Drevo home">
          <LogoMark size="md" />
        </Link>

        <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2">
          <ThemeToggle />
          <Show when="signed-in">
            <Link
              href="/projects"
              className="inline-flex h-11 shrink-0 items-center rounded-full px-2.5 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Projects
            </Link>

            <OrgSwitcher orgs={orgs} activeOrganizationId={pick?.organization.id ?? null} />
            <MembersDialog key={`members-${pick?.organization.id}`} />

            <UserButton />
          </Show>

          <Show when="signed-out">
            <SignInButton mode="modal">
              <Button
                variant="ghost"
                size="sm"
                className="h-11 min-h-11 px-3 text-sm font-medium text-foreground hover:bg-muted lg:h-8 lg:min-h-8"
              >
                Sign in
              </Button>
            </SignInButton>

            <SignInButton mode="modal">
              <Button
                size="sm"
                className="inline-flex h-11 min-h-11 items-center gap-1.5 rounded-full bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 sm:px-4 lg:h-8 lg:min-h-8"
              >
                Get Started
                <ArrowRight className="size-3.5 opacity-80" aria-hidden="true" />
              </Button>
            </SignInButton>
          </Show>
        </div>
      </nav>
    </header>
  );
}
