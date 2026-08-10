export function routeFromHash() {
  return location.hash.replace(/^#\/?/, "") || "home";
}
export function navigate(route: string) {
  location.hash = `#/${route}`;
}
