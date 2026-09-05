export const ROUTES = [
  "setup",
  "key",
  "create",
  "restore",
  "unlock",
  "dashboard",
  "send",
  "result",
  // Mobile-only destinations. Harmless on desktop, which simply never links
  // to them; the shell decides which routes it can render.
  "receive",
  "scan",
  "settings",
  "tx",
  "export",
] as const;
export type Route = (typeof ROUTES)[number];

export function currentRoute(): Route {
  const hash = window.location.hash.replace(/^#\/?/, "");
  return (ROUTES as readonly string[]).includes(hash) ? (hash as Route) : "setup";
}

export function navigate(route: Route): void {
  if (currentRoute() === route) {
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    return;
  }
  window.location.hash = `#/${route}`;
}
