export const ROUTES = ["setup", "key", "unlock", "dashboard", "send", "result"] as const;
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
