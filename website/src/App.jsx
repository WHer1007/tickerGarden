const layers = [
  {
    label: "Contracts",
    detail: "V2 namespace and Foundry profile are ready for the canonical ABI implementation.",
    status: "Scaffolded",
  },
  {
    label: "Execution data",
    detail: "Canonical ABI and the all-official-STOCK identity rule are frozen; the current observation verifies 194 assets and their shared Beacon implementation.",
    status: "Spec frozen",
  },
  {
    label: "Services",
    detail: "API, indexer, deployment, and maintenance boundaries are prepared for integration.",
    status: "Scaffolded",
  },
  {
    label: "Web surface",
    detail: "This status page is intentionally read-only while the protocol runtime is implemented.",
    status: "Online",
  },
];

function App() {
  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="TickerGarden home">
          <img src="/assets/tickergarden-mark.png" alt="" />
          <span>TickerGarden</span>
        </a>
        <span className="version-pill">V2 / BUILD 001</span>
      </header>

      <section className="intro" aria-labelledby="page-title">
        <p className="eyebrow">Protocol workspace · execution spec V2-EXEC-3</p>
        <h1 id="page-title">A garden for<br /><em>composable markets.</em></h1>
        <p className="lede">
          The TickerGarden V2 foundation is in place. Product runtime is not implemented yet;
          this surface makes the boundary and readiness of each layer explicit.
        </p>
        <div className="state-card" role="status">
          <span className="state-dot" aria-hidden="true" />
          <div>
            <strong>IMPLEMENTATION_ALLOWED</strong>
            <span>All 194 currently observed ACTIVE official RH STOCK assets are eligible. Each market snapshots a 10-STOCK saturation amount and releases the staker fee bucket linearly; no STOCK price, Chainlink feed, or backing target is required. Deployment remains blocked by the deployment gates.</span>
          </div>
          <span className="spec-id">V2-EXEC-3</span>
        </div>
      </section>

      <section className="layers" aria-labelledby="layers-title">
        <div className="section-heading">
          <p className="eyebrow">Readiness map</p>
          <h2 id="layers-title">One source of truth, four layers.</h2>
        </div>
        <div className="layer-grid">
          {layers.map((layer, index) => (
            <article className="layer" key={layer.label}>
              <div className="layer-index">0{index + 1}</div>
              <div className="layer-copy">
                <div className="layer-title-row">
                  <h3>{layer.label}</h3>
                  <span className="layer-status">{layer.status}</span>
                </div>
                <p>{layer.detail}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <footer className="footer">
        <span>Built for transparent protocol iteration.</span>
        <span>Product runtime: <strong>not implemented</strong></span>
      </footer>
    </main>
  );
}

export default App;
