const stage = document.querySelector<HTMLElement>("[data-garden]");
if (stage) {
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    observer.disconnect();
    void import("./garden-3d.ts").then(({ mountGarden }) => {
      const dispose = mountGarden(stage);
      window.addEventListener("pagehide", (event) => { if (!event.persisted) dispose(); }, { once: true });
      if (import.meta.hot) import.meta.hot.dispose(dispose);
    }).catch(() => {
      // WebGL unavailable, context creation refused, or chunk failed: retain the original tree.
      stage.classList.remove("garden-ready");
    });
  }, { rootMargin: "160px" });
  observer.observe(stage);
}
