/** Remove explorer-only boot markup before loading an admin screen. */
export function prepareRouteBoot(pathname: string, body: HTMLElement, host: HTMLElement): void {
  if (!['/admin', '/admin-demo', '/admin-local'].includes(pathname)) return
  body.classList.remove('explore-fullbleed')
  host.replaceChildren()
}
