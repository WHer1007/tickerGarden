# Legal-page maintenance notes

Updated: 2026-09-16. Internal maintenance record; not part of the public agreement.

## Approved publication choices

The owner requested production-facing Privacy and Terms copy without draft banners, launch checklists, or implementation commentary. The owner confirmed Singapore and `info@tickergarden.com`, and explicitly requested that the operator's legal name not be displayed for now. These instructions supersede the previous requirement to retain pre-launch banners.

Both pages use a last-updated date and the supplied contact email. No company registration, registered address, named legal entity, external legal review, exclusive court, mandatory arbitration clause, or monetary liability cap has been invented. The country statement is not treated as an instruction to select exclusive Singapore jurisdiction.

## Content and implementation alignment

- Fonts are self-hosted. Remove the former Google Fonts disclosure.
- Browser storage supports wallet preferences, creation details, transaction recovery, and recent selections. Public addresses and transaction hashes may be stored for recovery; private keys and recovery phrases are not collected through wallet connection.
- Production hosting, security, blockchain access, and content providers include Vercel, Cloudflare, DigitalOcean, Alchemy, and Pinata. User-published metadata may persist on IPFS even without a successful token launch.
- No advertising SDK was found in the current frontend. Do not turn this into an unsupported company-wide promise that all information is never sold or shared.
- State that community tokens are separate from Stock ownership and redemption rights; rewards depend on actual fees. Describe fees and exits in user language, with Docs links for details.
- USDG's 1 USD display convention is not a market-price or redemption guarantee.
- Preserve the absence of an independent external contract audit, the limits of internal security review, and mandatory statutory rights.
- Risk disclosure is consolidated in Docs. The owner requested removal of /risks without a redirect, a footer Risk link to /docs#docs-risks, and contextual Create/Trade/Stake notices.

## Ongoing responsibilities

The text is not evidence that every legal or operational obligation has been fulfilled. The operator remains responsible for an active privacy request process, applicable data-protection officer arrangements, provider/transfer safeguards, retention practices, required notices, and jurisdiction-specific legal review. Revisit the identity disclosure when the owner supplies the public operator details.

References checked for the wording:

- Singapore PDPC data protection obligations: https://www.pdpc.gov.sg/overview-of-pdpa/the-legislation/personal-data-protection-act/data-protection-obligations
- Singapore PDPC notification guidance: https://www.pdpc.gov.sg/help-and-resources/2019/09/guide-to-notification
- FTC privacy promises and actual practices: https://www.ftc.gov/business-guidance/privacy-security

Code and runtime validation do not constitute legal approval or test mailbox delivery. No email was sent as part of this work.
