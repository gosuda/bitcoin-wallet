export const ROUTES = [
  "setup",
  "key",
  "create",
  "restore",
  "unlock",
  "dashboard",
  "send",
  "result",
  "settings",
  "psbt",
  // Phone-only destinations; the desktop's guard sends them to the wallet
  // (`PHONE_ONLY` in guards.ts).
  "receive",
  "scan",
  "tx",
  "export",
  "coins",
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
