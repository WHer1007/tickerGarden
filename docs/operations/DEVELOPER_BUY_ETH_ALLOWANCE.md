# Developer Buy ETH allowance

Developer Buy keeps the requested paired-asset quantity. When the wallet holds less than that quantity, only the missing quantity is purchased. The confirmation displays the quoted ETH cost and an ETH purchase limit of `ceil(quotedWei * 110 / 100)`. Launch fees and estimated gas are reserved separately.

The confirmed ETH limit is immutable for that attempt. Refreshing the quote does not add another 10%. A refreshed cost above the confirmed limit, a changed asset/network, an increased missing quantity, or an insufficient wallet balance stops before submitting a purchase. The request value and router ETH limit use the same confirmed amount. Quotes and transaction deadlines remain enforced.

Direct V3/V4 purchases and V3 multihop purchases use exact output and refund unspent ETH. V3 multihop uses one reversed path so the intermediate USDG amount is not an obsolete per-hop cap.

A mixed V3-to-V4 path cannot settle both protocols with one exact-output callback. It exchanges the approved ETH budget into USDG, buys the exact Stock quantity with V4, and returns unused intermediate USDG to the wallet. Consequently the wallet may spend the full ETH budget and receive residual USDG; this is disclosed in the confirmation notice. The complete router transaction reverts atomically if the Stock target cannot be met. No additional wallet ETH may be drawn. Any native/WETH remainder is also returned.

Validation: unit tests cover cap rounding, immutable approved limits, direct and intermediate route encodings, fixed output, and refund recipients. `TG_CAP_DRIFT=1 node --experimental-strip-types tools/research/verify-quote-purchase-fork.mjs` uses a local mainnet fork with the displayed input quote reduced to 98% of the live quote. It verifies a purchase above the old exact amount but below its 110% cap, exact token receipts, ETH spending bounds, underfunded atomic rollback, and the CRM purchase/approval/launch flow. The upstream RPC proxy forbids transaction submission.

No TickerGarden contract deployment or read-API response change is required. The shared transaction builder is bundled into Web.
