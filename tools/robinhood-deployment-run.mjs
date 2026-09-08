// Optional isolated run directory; defaults preserve historical tooling behavior.
const run = process.env.TG_RH_DEPLOYMENT_RUN;
if (run && !/^[a-z0-9-]+$/.test(run)) throw Error('Invalid RH deployment run label');
export const reviewPath = `outputs/reviews/${run ?? 'robinhood-testnet-continuous-2026-09-08'}`;
export const simulationPath = `outputs/reviews/${run ? `${run}-simulation` : 'robinhood-testnet-continuous-simulation-2026-09-08'}`;
