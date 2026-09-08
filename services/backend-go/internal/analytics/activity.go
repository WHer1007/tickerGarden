package analytics

// TradeActivity is one execution. Conversion summaries annotate its economic
// category; they never create a second volume-bearing record.
type TradeActivity struct {
	Source          CurveSource `json:"source"`
	Venue           string      `json:"venue"`
	MarketID        string      `json:"marketId"`
	Timestamp       string      `json:"timestamp"`
	Side            string      `json:"side"`
	Classification  string      `json:"classification"`
	Actor           *string     `json:"actor"`
	ActorConfidence string      `json:"actorConfidence"`
	Recipient       *string     `json:"recipient"`
	MemeAsset       string      `json:"memeAsset"`
	QuoteAsset      string      `json:"quoteAsset"`
	QuoteDecimals   uint8       `json:"quoteDecimals"`
	MemeRaw         string      `json:"memeRaw"`
	QuoteRaw        string      `json:"quoteRaw"`
	AmountBasis     string      `json:"amountBasis"`
	Price           CandlePrice `json:"price"`
	PriceUnit       string      `json:"priceUnit"`
	FeeRaw          *string     `json:"feeRaw"`
	FeeAsset        *string     `json:"feeAsset"`
	TaxRaw          *string     `json:"taxRaw"`
	FeeStatus       string      `json:"feeStatus"`
}

func curveActivity(o CurveObservation) TradeActivity {
	return TradeActivity{Source: o.Source, Venue: "curve", MarketID: o.MarketID, Timestamp: o.BlockTimestamp, Side: o.Amounts.Side, Classification: o.Classification, Actor: &o.Actor, ActorConfidence: o.ActorConfidence, Recipient: &o.Recipient, MemeAsset: o.MemeToken, QuoteAsset: o.QuoteAsset, QuoteDecimals: o.QuoteDecimals, MemeRaw: o.Amounts.MemeRaw, QuoteRaw: o.Amounts.QuoteCurveRaw, AmountBasis: "CURVE_EXCLUDING_FEE_TAX", Price: CandlePrice{Numerator: o.Amounts.PriceNumerator, Denominator: o.Amounts.PriceDenominator}, PriceUnit: "QUOTE_PER_WHOLE_MEME", FeeRaw: &o.Amounts.FeeRaw, FeeAsset: &o.QuoteAsset, TaxRaw: &o.Amounts.TaxRaw, FeeStatus: "event_reported"}
}
func poolActivity(o PoolObservation) TradeActivity {
	var asset *string
	if o.Amounts.FeeAsset != "" {
		asset = &o.Amounts.FeeAsset
	}
	// Swap sender is the immediate PoolManager caller, often a router or Hook.
	// Recipient and ultimate wallet ownership are not inferable from this field.
	var actor *string
	confidence := "unavailable"
	if addressRE.MatchString(o.Sender) {
		actor = &o.Sender
		confidence = "contract_caller_not_verified_wallet"
	}
	return TradeActivity{Source: o.Source, Venue: "pool", MarketID: o.MarketID, Timestamp: o.BlockTimestamp, Side: o.Amounts.Side, Classification: o.Classification, Actor: actor, ActorConfidence: confidence, MemeAsset: o.MemeToken, QuoteAsset: o.QuoteAsset, QuoteDecimals: o.QuoteDecimals, MemeRaw: o.Amounts.MemeCoreRaw, QuoteRaw: o.Amounts.QuoteCoreRaw, AmountBasis: "POOL_CORE", Price: CandlePrice{Numerator: o.Amounts.PriceNumerator, Denominator: o.Amounts.PriceDenominator}, PriceUnit: "QUOTE_PER_WHOLE_MEME", FeeRaw: o.Amounts.FeeRaw, FeeAsset: asset, FeeStatus: o.Amounts.FeeStatus}
}
