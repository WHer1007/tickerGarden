# TickerGarden legal-page review notes

> Review date: 2026-09-04
> Status: implementation aid only; not legal advice and not part of the public agreement

## Reference material

- Pons Privacy Policy: <https://www.ponsfamily.com/privacy>
- Pons Terms of Use: <https://www.ponsfamily.com/terms>
- TickerGarden protocol/product source: [`../V1_PROTOCOL_PARAMETERS.md`](../V1_PROTOCOL_PARAMETERS.md)
- TickerGarden brand-language source: [`../brand/BRAND_CULTURE_AND_ECOSYSTEM.md`](../brand/BRAND_CULTURE_AND_ECOSYSTEM.md)

Pons was used as a structural reference for topics expected on a wallet-connected token interface: public blockchain data, browser and infrastructure data, third-party providers, wallet security, irreversible transactions, user-created content, market and liquidity risk, fees, acceptable use, warranty and liability boundaries, and legal contacts.

TickerGarden text was independently drafted and is not a copy of Pons's legal text.

## TickerGarden-specific differences

1. The interface does not hold private keys, but protocol contracts can hold allocated STOCK in the canonical `UserStockVault`. The public language therefore distinguishes a noncustodial interface from smart-contract custody.
2. Ticker Meme tokens are explicitly separated from stock ownership, dividends, voting, redemption, price tracking, or collateral claims.
3. One eligible STOCK may anchor multiple independent Ticker Meme markets.
4. `Bloom` is user language for successful Graduation and is true only at canonical `PoolCreated`; it is not a quality or value signal.
5. STOCK allocation begins only after Bloom and shares only fees actually generated under the market's rules. It does not mint Meme tokens or create a fixed return.
6. `rageQuit` is described as a contract exit that returns allocated principal under the current rules while forfeiting unclaimed fees; it is not insurance.
7. Treasury language is conditional because the production release gate remains open.
8. Pons's legal entity, jurisdiction list, governing law, arbitration process, liability cap, contacts, and effective dates are specific to Pons and were not reused.

## Required legal decisions before production publication

- operator legal name, legal form, registered address, and role as data controller;
- monitored legal, privacy, security, and copyright contact channels;
- effective dates and version/change-notice process;
- launch jurisdictions, restricted jurisdictions, sanctions screening, and age rules;
- governing law, forum or arbitration model, informal-resolution process, and consumer-law variations;
- warranty exclusions, protected parties, liability cap and carve-outs, indemnification, and release language;
- complete production vendor and data-flow inventory, including hosting, RPC, APIs, indexers, fonts, metadata gateways, security, analytics, logs, and retention;
- regional privacy disclosures, request verification, appeals, international-transfer mechanisms, and cookie/consent requirements;
- review of Stock Token, fee allocation, Treasury, creator, marketing, and Ticker Meme terminology in each offered jurisdiction.

Until these items are approved, the public pages must continue to display `Pre-launch legal draft` and must not be represented as effective Terms or a final Privacy Policy.
