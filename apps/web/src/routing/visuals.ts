export function mountPageVisuals(root: HTMLElement): () => void {
  let stopped = false;
  let cleanup: (() => void) | undefined;
  const stage = root.querySelector<HTMLElement>("[data-signal-arbor]");
  if (stage) void import("../home/signal-arbor.ts").then(({ mountArbor }) => mountArbor(stage)).then(dispose => {
    if (stopped) dispose();
    else cleanup = dispose;
  }).catch(() => { stage?.classList.add("is-fallback"); });
  return () => { stopped = true; cleanup?.(); };
}
