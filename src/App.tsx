import { useEffect, useState, type ReactNode } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { Redirect, useLocation } from "wouter";
import { IconBrandTwitch, IconLogout } from "@tabler/icons-react";
import { Button } from "@ui/components/button";
import {
  Card,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@ui/components/card";
import { PixelLoader } from "@ui/components/spinner";
import { toast } from "@ui/components/toast";
import { api } from "../convex/_generated/api";
import { authClient, useSignOut } from "./authClient";
import { History } from "./pages/History";
import { Overview } from "./pages/Overview";
import { Run } from "./pages/Run";
import { Runs } from "./pages/Runs";
import { Settings } from "./pages/Settings";
import { Style } from "./pages/Style";
import { routeFor, type Role, type Route } from "./routes";
import { PageSkeleton } from "./PageSkeleton";
import { Shell } from "./Shell";

export function App() {
  // Until sign-in settles, queries run as no one, and the viewer would come
  // back signed out for a moment.
  const { isLoading: settling } = useConvexAuth();
  const viewer = useQuery(api.panel.viewer, settling ? "skip" : {});
  const status = viewer?.status;
  useEffect(() => {
    if (status) {
      rememberRole(status === "owner" || status === "mod" ? status : null);
    }
  }, [status]);

  if (settling || viewer === undefined) {
    // Signed in last time, it's most likely the Panel coming, so its shape
    // shows. Otherwise there's no telling which screen it'll be.
    const last = lastRole();
    return last ? <Routes lastRole={last} /> : <Loading />;
  }

  if (viewer.status === "signedOut") {
    return (
      <main className="flex min-h-svh items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <SignInButton />
        </div>
      </main>
    );
  }

  if (viewer.status === "notAuthorized") {
    return (
      <Centered>
        <CardHeader className="items-center text-center">
          <CardTitle>Unauthorized</CardTitle>
        </CardHeader>
        <CardFooter>
          <SignOutButton />
        </CardFooter>
      </Centered>
    );
  }

  return <Routes role={viewer.status} displayName={viewer.displayName} />;
}

// Stays pending once it has worked, while the browser leaves for Twitch.
function SignInButton() {
  const [signingIn, setSigningIn] = useState(false);
  return (
    <Button
      className="w-full"
      pending={signingIn}
      onClick={async () => {
        setSigningIn(true);
        // Lands on the Overview, signed in.
        const { error } = await authClient.signIn.oauth2({
          providerId: "twitch",
          callbackURL: "/",
        });
        if (error) {
          setSigningIn(false);
          toast.add({ type: "error", title: "Couldn't sign in. Try again." });
        }
      }}
    >
      <IconBrandTwitch data-icon="inline-start" />
      Sign in with Twitch
    </Button>
  );
}

function SignOutButton() {
  const { signingOut, signOut } = useSignOut();
  return (
    <Button variant="outline" className="w-full" pending={signingOut} onClick={signOut}>
      <IconLogout data-icon="inline-start" />
      Sign out
    </Button>
  );
}

// Without a role, while who's viewing isn't known, the Shell and the page
// are skeletons, shaped for who it was last time.
function Routes({
  role,
  lastRole = "mod",
  displayName,
}: {
  role?: Role;
  lastRole?: Role;
  displayName?: string;
}) {
  const [path] = useLocation();
  const route = routeFor(path);
  if ("redirect" in route) {
    return <Redirect to={route.redirect} replace />;
  }
  return (
    <Shell
      role={role}
      displayName={displayName}
      page={route.page}
      title={route.title}
    >
      {role ? (
        <Page route={route} role={role} />
      ) : (
        <PageSkeleton page={route.page} role={lastRole} />
      )}
    </Shell>
  );
}

function Page({ route, role }: { route: Exclude<Route, { redirect: "/" }>; role: Role }) {
  return (
    <>
      {route.page === "overview" && <Overview />}
      {route.page === "runs" && <Runs role={role} />}
      {route.page === "run" && <Run key={route.runId} runId={route.runId} />}
      {route.page === "history" && <History />}
      {route.page === "style" && <Style />}
      {route.page === "settings" && <Settings role={role} />}
    </>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">{children}</Card>
    </main>
  );
}

// Who this browser was signed in to the Panel as last time, if anyone, so a
// refresh shows the Panel's shape while signing in again rather than a
// loader.
const ROLE_KEY = "erdtrack.lastRole";

function lastRole(): Role | null {
  try {
    const role = localStorage.getItem(ROLE_KEY);
    return role === "owner" || role === "mod" ? role : null;
  } catch {
    return null;
  }
}

function rememberRole(role: Role | null) {
  try {
    if (role) {
      localStorage.setItem(ROLE_KEY, role);
    } else {
      localStorage.removeItem(ROLE_KEY);
    }
  } catch {
    // Without storage, a refresh shows the loader.
  }
}

// Signing in, with no telling yet whether it's the Panel or the sign-in
// screen coming.
function Loading() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4">
      <PixelLoader />
    </main>
  );
}
