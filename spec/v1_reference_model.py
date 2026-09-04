"""Pure-integer reference model for frozen TickerGarden V1 arithmetic.

The launch math in this module follows the approved TG-PONS-BEHAVIOR-1
behavioral baseline.  It is an independent specification, not imported Pons
production code.  Every public arithmetic helper models an explicit Solidity
integer domain; products that may exceed 256 bits use ``mulDiv`` semantics.
"""

from dataclasses import dataclass
from math import isqrt


FEE_PIPS = 10_000
PIPS_DENOMINATOR = 1_000_000
LP_SHARE_BPS = 0
BPS_DENOMINATOR = 10_000
INDEX_PRECISION = 10**27
ACTIVATION_WHEEL_SIZE = 32
ACTIVATION_DELAY_SECONDS = 30
COMPONENT_SALT_DOMAIN_LABEL = "TICKERGARDEN_V1_COMPONENT_SALT"
QUOTE_ECONOMICS_DOMAIN_LABEL = "TICKERGARDEN_V1_QUOTE_ECONOMICS"
UINT256_MAX = 2**256 - 1
UINT192_MAX = 2**192 - 1
UINT160_MAX = 2**160 - 1
UINT128_MAX = 2**128 - 1
INT128_MAX = 2**127 - 1
UINT64_MAX = 2**64 - 1
UINT32_MAX = 2**32 - 1
MIN_TICK = -887_272
MAX_TICK = 887_272
MIN_SQRT_PRICE = 4_295_128_739
MAX_SQRT_PRICE = 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342
Q96 = 2**96
SNIPE_TAX_START_BPS = 9_900
SNIPE_TAX_SECONDS = 3
SNIPE_TAX_RAW_BY_ELAPSED_SECOND = (9_900, 618, 19)
SNIPE_MIN_NET_BPS = 100
MIN_SUPPORTED_ASSET_DECIMALS = 6
MAX_SUPPORTED_ASSET_DECIMALS = 18
LEGACY_LP_SHARE_BPS = 2_000
LEGACY_STAKE_SATURATION_WHOLE_TOKENS = 10
STAKER_NON_LP_SHARE_BPS = 3_000
PLATFORM_NON_LP_SHARE_BPS = 3_000
MINIMUM_SAFE_ALLOCATION_RAW = 414
MAX_ACCOUNTING_AMOUNT = INT128_MAX
MAX_LIFETIME_FEE_CREDITS = 2**48 - 1


def _require_non_negative(**values: int) -> None:
    for name, value in values.items():
        if value < 0:
            raise ValueError(f"{name} must be non-negative")


def _require_uint(bits: int = 256, **values: int) -> None:
    maximum = 2**bits - 1
    for name, value in values.items():
        if value < 0 or value > maximum:
            raise ValueError(f"{name} must fit uint{bits}")


def checked_add_uint256(*values: int) -> int:
    _require_uint(**{f"value_{index}": value for index, value in enumerate(values)})
    result = sum(values)
    if result > UINT256_MAX:
        raise ValueError("uint256 addition overflow")
    return result


def checked_mul_uint256(left: int, right: int) -> int:
    _require_uint(left=left, right=right)
    result = left * right
    if result > UINT256_MAX:
        raise ValueError("uint256 multiplication overflow")
    return result


def mul_div_floor(left: int, right: int, denominator: int) -> int:
    """OpenZeppelin/Uniswap full-precision ``mulDiv`` with floor rounding."""

    _require_uint(left=left, right=right, denominator=denominator)
    if denominator == 0:
        raise ValueError("denominator must be positive")
    result = left * right // denominator
    if result > UINT256_MAX:
        raise ValueError("mulDiv result overflows uint256")
    return result


def mul_div_ceil(left: int, right: int, denominator: int) -> int:
    """Full-precision ``mulDiv`` with ceiling rounding and no ``x + d - 1``."""

    result = mul_div_floor(left, right, denominator)
    if (left * right) % denominator:
        if result == UINT256_MAX:
            raise ValueError("mulDiv rounding overflows uint256")
        result += 1
    return result


def mul_div_with_remainder(left: int, right: int, denominator: int) -> tuple[int, int]:
    quotient = mul_div_floor(left, right, denominator)
    return quotient, (left * right) % denominator


def product_lte(left_a: int, left_b: int, right_a: int, right_b: int) -> bool:
    """Compare two 512-bit products without narrowing either side."""

    _require_uint(
        left_a=left_a,
        left_b=left_b,
        right_a=right_a,
        right_b=right_b,
    )
    return left_a * left_b <= right_a * right_b


@dataclass(frozen=True)
class SupplyPartition:
    reserved: int
    sellable: int


def partition_supply(
    supply: int, phantom_quote: int, graduation_threshold: int
) -> SupplyPartition:
    """Apply the frozen reserve ratio without assuming quote decimals."""

    _require_uint(
        supply=supply,
        phantom_quote=phantom_quote,
        graduation_threshold=graduation_threshold,
    )
    if supply == 0 or phantom_quote == 0 or graduation_threshold == 0:
        raise ValueError("supply, phantom_quote and graduation_threshold must be positive")
    denominator = checked_add_uint256(phantom_quote, graduation_threshold)
    reserved = mul_div_floor(supply, phantom_quote, denominator)
    return SupplyPartition(reserved=reserved, sellable=supply - reserved)


def _ceil_div(numerator: int, denominator: int) -> int:
    _require_uint(numerator=numerator, denominator=denominator)
    if denominator <= 0:
        raise ValueError("denominator must be positive")
    return numerator // denominator + int(numerator % denominator != 0)


def curve_amount_out(
    amount_in: int, reserve_in: int, reserve_out: int, fee_bps: int = 0
) -> int:
    """Pons-compatible exact-input constant-product quote with floor rounding."""

    _require_uint(
        amount_in=amount_in,
        reserve_in=reserve_in,
        reserve_out=reserve_out,
        fee_bps=fee_bps,
    )
    if amount_in == 0:
        raise ValueError("amount_in must be positive")
    if reserve_in == 0 or reserve_out == 0:
        raise ValueError("reserves must be positive")
    if fee_bps >= BPS_DENOMINATOR:
        raise ValueError("fee_bps must be below 10000")
    amount_in_with_fee = checked_mul_uint256(
        amount_in, BPS_DENOMINATOR - fee_bps
    )
    denominator = checked_add_uint256(
        checked_mul_uint256(reserve_in, BPS_DENOMINATOR), amount_in_with_fee
    )
    amount_out = mul_div_floor(amount_in_with_fee, reserve_out, denominator)
    if amount_out == 0:
        raise ValueError("amount_out rounds to zero")
    return amount_out


def curve_amount_in(
    amount_out: int, reserve_in: int, reserve_out: int, fee_bps: int = 0
) -> int:
    """Pons-compatible exact-output quote, including its final +1 rounding."""

    _require_uint(
        amount_out=amount_out,
        reserve_in=reserve_in,
        reserve_out=reserve_out,
        fee_bps=fee_bps,
    )
    if amount_out == 0:
        raise ValueError("amount_out must be positive")
    if reserve_in == 0 or reserve_out <= amount_out:
        raise ValueError("insufficient liquidity")
    if fee_bps >= BPS_DENOMINATOR:
        raise ValueError("fee_bps must be below 10000")
    scaled_reserve = checked_mul_uint256(reserve_in, BPS_DENOMINATOR)
    denominator = checked_mul_uint256(
        reserve_out - amount_out, BPS_DENOMINATOR - fee_bps
    )
    quoted = mul_div_floor(amount_out, scaled_reserve, denominator)
    return checked_add_uint256(quoted, 1)


@dataclass(frozen=True)
class CurveBuyQuote:
    quote_received: int
    quote_spent: int
    fee: int
    additional_quote_fee: int
    net_quote: int
    tokens_out: int
    refund: int
    partial_fill: bool
    net_required: int | None
    slippage_pass: bool


def quote_curve_buy(
    quote_received: int,
    quote_reserve: int,
    token_reserve: int,
    reserved_tokens: int,
    fee_bps: int,
    additional_quote_fee_bps: int = 0,
    min_tokens_out: int = 0,
) -> CurveBuyQuote:
    """Quote a buy including the Pons tail-fill and proportional min-out rule.

    ``additional_quote_fee_bps`` represents a separately rounded quote fee
    such as a frozen anti-snipe charge.  TickerGarden production creator tax is
    fixed to zero, but keeping the second leg explicit proves ordering and
    conservation without assigning Pons beneficiaries.
    """

    _require_uint(
        quote_received=quote_received,
        quote_reserve=quote_reserve,
        token_reserve=token_reserve,
        reserved_tokens=reserved_tokens,
        fee_bps=fee_bps,
        additional_quote_fee_bps=additional_quote_fee_bps,
        min_tokens_out=min_tokens_out,
    )
    total_fee_bps = checked_add_uint256(fee_bps, additional_quote_fee_bps)
    if total_fee_bps >= BPS_DENOMINATOR:
        raise ValueError("combined quote fees must leave positive net input")
    if token_reserve <= reserved_tokens:
        raise ValueError("curve has no sellable tokens")

    quote_spent = quote_received
    fee = mul_div_floor(quote_spent, fee_bps, BPS_DENOMINATOR)
    additional_fee = mul_div_floor(
        quote_spent, additional_quote_fee_bps, BPS_DENOMINATOR
    )
    net_quote = quote_spent - fee - additional_fee
    tokens_out = curve_amount_out(net_quote, quote_reserve, token_reserve, 0)
    sellable = token_reserve - reserved_tokens
    partial_fill = tokens_out > sellable
    net_required = None

    if partial_fill:
        tokens_out = sellable
        net_required = curve_amount_in(sellable, quote_reserve, token_reserve, 0)
        quote_spent = min(
            mul_div_ceil(
                net_required,
                BPS_DENOMINATOR,
                BPS_DENOMINATOR - total_fee_bps,
            ),
            quote_received,
        )
        fee = mul_div_floor(quote_spent, fee_bps, BPS_DENOMINATOR)
        additional_fee = mul_div_floor(
            quote_spent, additional_quote_fee_bps, BPS_DENOMINATOR
        )
        net_quote = quote_spent - fee - additional_fee

    slippage_pass = product_lte(
        quote_spent, min_tokens_out, quote_received, tokens_out
    )
    return CurveBuyQuote(
        quote_received=quote_received,
        quote_spent=quote_spent,
        fee=fee,
        additional_quote_fee=additional_fee,
        net_quote=net_quote,
        tokens_out=tokens_out,
        refund=quote_received - quote_spent,
        partial_fill=partial_fill,
        net_required=net_required,
        slippage_pass=slippage_pass,
    )


@dataclass(frozen=True)
class CurveSellQuote:
    gross_quote_out: int
    fee: int
    additional_quote_fee: int
    quote_out: int
    slippage_pass: bool


def quote_curve_sell(
    tokens_in: int,
    token_reserve: int,
    quote_reserve: int,
    fee_bps: int,
    additional_quote_fee_bps: int = 0,
    min_quote_out: int = 0,
) -> CurveSellQuote:
    """Quote a sell, applying both fee legs after gross quote pricing."""

    _require_uint(
        tokens_in=tokens_in,
        token_reserve=token_reserve,
        quote_reserve=quote_reserve,
        fee_bps=fee_bps,
        additional_quote_fee_bps=additional_quote_fee_bps,
        min_quote_out=min_quote_out,
    )
    if checked_add_uint256(fee_bps, additional_quote_fee_bps) >= BPS_DENOMINATOR:
        raise ValueError("combined quote fees must leave positive output")
    gross = curve_amount_out(tokens_in, token_reserve, quote_reserve, 0)
    fee = mul_div_floor(gross, fee_bps, BPS_DENOMINATOR)
    additional_fee = mul_div_floor(gross, additional_quote_fee_bps, BPS_DENOMINATOR)
    quote_out = gross - fee - additional_fee
    return CurveSellQuote(
        gross_quote_out=gross,
        fee=fee,
        additional_quote_fee=additional_fee,
        quote_out=quote_out,
        slippage_pass=quote_out >= min_quote_out,
    )


@dataclass(frozen=True)
class GraduationPartition:
    pool_meme_amount: int
    locked_excess_meme: int


def partition_graduation_tokens(
    swept_quote: int, phantom_quote: int, swept_tokens: int
) -> GraduationPartition:
    """Remove virtual quote while preserving the terminal curve price."""

    _require_uint(
        swept_quote=swept_quote,
        phantom_quote=phantom_quote,
        swept_tokens=swept_tokens,
    )
    if swept_quote == 0 or phantom_quote == 0 or swept_tokens == 0:
        raise ValueError("graduation amounts must be positive")
    virtual_quote = checked_add_uint256(swept_quote, phantom_quote)
    pool_amount = mul_div_floor(swept_tokens, swept_quote, virtual_quote)
    if pool_amount == 0:
        raise ValueError("pool meme amount rounds to zero")
    return GraduationPartition(
        pool_meme_amount=pool_amount,
        locked_excess_meme=swept_tokens - pool_amount,
    )


def current_snipe_tax_bps(elapsed_seconds: int, exempt: bool = False) -> int:
    """Return the frozen three-second runtime schedule for a buy recipient."""

    _require_uint(64, elapsed_seconds=elapsed_seconds)
    if exempt or elapsed_seconds >= SNIPE_TAX_SECONDS:
        return 0
    return SNIPE_TAX_RAW_BY_ELAPSED_SECOND[elapsed_seconds]


def effective_snipe_tax_bps(
    raw_snipe_bps: int,
    fee_bps: int,
    creator_tax_bps: int = 0,
    minimum_net_bps: int = SNIPE_MIN_NET_BPS,
) -> int:
    """Apply Pons' buy-only cap while preserving at least 1% net Quote."""

    _require_uint(
        raw_snipe_bps=raw_snipe_bps,
        fee_bps=fee_bps,
        creator_tax_bps=creator_tax_bps,
        minimum_net_bps=minimum_net_bps,
    )
    committed = checked_add_uint256(fee_bps, creator_tax_bps, minimum_net_bps)
    if committed > BPS_DENOMINATOR:
        raise ValueError("fee legs leave less than the minimum net Quote")
    return min(raw_snipe_bps, BPS_DENOMINATOR - committed)


def _solidity_div_toward_zero(value: int, divisor: int) -> int:
    if divisor <= 0:
        raise ValueError("divisor must be positive")
    quotient = abs(value) // divisor
    return -quotient if value < 0 else quotient


def full_range_ticks(tick_spacing: int) -> tuple[int, int]:
    if tick_spacing <= 0 or tick_spacing > 32_767:
        raise ValueError("tick_spacing must fit the positive int16 domain")
    return (
        _solidity_div_toward_zero(MIN_TICK, tick_spacing) * tick_spacing,
        _solidity_div_toward_zero(MAX_TICK, tick_spacing) * tick_spacing,
    )


_TICK_MULTIPLIERS = (
    (0x1, 0xFFFcb933bd6fad37aa2d162d1a594001),
    (0x2, 0xFFF97272373d413259a46990580e213a),
    (0x4, 0xFFF2e50f5f656932ef12357cf3c7fdcc),
    (0x8, 0xFFE5caca7e10e4e61c3624eaa0941cd0),
    (0x10, 0xFFCB9843d60f6159c9db58835c926644),
    (0x20, 0xFF973b41fa98c081472e6896dfb254c0),
    (0x40, 0xFF2ea16466c96a3843ec78b326b52861),
    (0x80, 0xFE5dee046a99a2a811c461f1969c3053),
    (0x100, 0xFCBE86c7900a88aedcffc83b479aa3a4),
    (0x200, 0xF987a7253ac413176f2b074cf7815e54),
    (0x400, 0xF3392b0822b70005940c7a398e4b70f3),
    (0x800, 0xE7159475a2c29b7443b29c7fa6e889d9),
    (0x1000, 0xD097f3bdfd2022b8845ad8f792aa5825),
    (0x2000, 0xA9F746462d870fdf8a65dc1f90e061e5),
    (0x4000, 0x70D869a156d2a1b890bb3df62baf32f7),
    (0x8000, 0x31BE135f97d08fd981231505542fcfa6),
    (0x10000, 0x9AA508b5b7a84e1c677de54f3e99bc9),
    (0x20000, 0x5D6af8dedb81196699c329225ee604),
    (0x40000, 0x2216e584f5fa1ea926041bedfe98),
    (0x80000, 0x48a170391f7dc42444e8fa2),
)


def sqrt_price_at_tick(tick: int) -> int:
    """Bit-exact port of Uniswap v4 ``TickMath.getSqrtPriceAtTick``."""

    if tick < MIN_TICK or tick > MAX_TICK:
        raise ValueError("tick is outside the Uniswap v4 domain")
    absolute_tick = abs(tick)
    price = 1 << 128
    for bit, multiplier in _TICK_MULTIPLIERS:
        if absolute_tick & bit:
            price = price * multiplier >> 128
    if tick > 0:
        price = UINT256_MAX // price
    result = (price + (2**32 - 1)) >> 32
    if result > UINT160_MAX:
        raise ValueError("sqrt price overflows uint160")
    return result


def sqrt_price_x96_from_amounts(amount0: int, amount1: int) -> int:
    """Mirror the selected graduation Q192/Q128 price construction."""

    _require_uint(amount0=amount0, amount1=amount1)
    if amount0 == 0 or amount1 == 0:
        raise ValueError("graduation amounts must be positive")
    fits_q192 = amount0 > UINT192_MAX or amount1 < amount0 << 64
    if fits_q192:
        result = isqrt(mul_div_floor(amount1, 2**192, amount0))
    else:
        fits_q128 = amount0 > UINT128_MAX or amount1 < amount0 << 128
        if not fits_q128:
            raise ValueError("graduation price is unsupported")
        sqrt_x64 = isqrt(mul_div_floor(amount1, 2**128, amount0))
        if sqrt_x64 > UINT128_MAX:
            raise ValueError("graduation price is unsupported")
        result = sqrt_x64 << 32
    if result > UINT160_MAX:
        raise ValueError("sqrt price overflows uint160")
    return result


def liquidity_for_amounts(
    sqrt_price_x96: int,
    sqrt_price_a_x96: int,
    sqrt_price_b_x96: int,
    amount0: int,
    amount1: int,
) -> int:
    """Mirror v4-periphery ``LiquidityAmounts.getLiquidityForAmounts``."""

    _require_uint(
        sqrt_price_x96=sqrt_price_x96,
        sqrt_price_a_x96=sqrt_price_a_x96,
        sqrt_price_b_x96=sqrt_price_b_x96,
        amount0=amount0,
        amount1=amount1,
    )
    lower, upper = sorted((sqrt_price_a_x96, sqrt_price_b_x96))
    if lower == upper:
        raise ValueError("liquidity price range must be nonzero")

    def for_amount0(price_a: int, price_b: int, amount: int) -> int:
        intermediate = mul_div_floor(price_a, price_b, Q96)
        return mul_div_floor(amount, intermediate, price_b - price_a)

    def for_amount1(price_a: int, price_b: int, amount: int) -> int:
        return mul_div_floor(amount, Q96, price_b - price_a)

    if sqrt_price_x96 <= lower:
        liquidity = for_amount0(lower, upper, amount0)
    elif sqrt_price_x96 < upper:
        liquidity = min(
            for_amount0(sqrt_price_x96, upper, amount0),
            for_amount1(lower, sqrt_price_x96, amount1),
        )
    else:
        liquidity = for_amount1(lower, upper, amount1)
    if liquidity > UINT128_MAX:
        raise ValueError("liquidity overflows uint128")
    return liquidity


def max_liquidity_per_tick(tick_spacing: int) -> int:
    tick_lower, tick_upper = full_range_ticks(tick_spacing)
    initialized_tick_count = (tick_upper - tick_lower) // tick_spacing + 1
    return UINT128_MAX // initialized_tick_count


@dataclass(frozen=True)
class GraduationSeed:
    quote_is_currency0: bool
    amount0: int
    amount1: int
    sqrt_price_x96: int
    tick_lower: int
    tick_upper: int
    liquidity: int
    max_liquidity_per_tick: int


def graduation_seed(
    token: str,
    quote_asset: str,
    tick_spacing: int,
    quote_amount: int,
    meme_amount: int,
) -> GraduationSeed:
    """Build and preflight the exact full-range V4 graduation seed."""

    token_value = int.from_bytes(_hex_bytes(token, 20), "big")
    quote_value = int.from_bytes(_hex_bytes(quote_asset, 20), "big")
    if token_value == 0:
        raise ValueError("meme token cannot be the native sentinel")
    _require_uint(128, quote_amount=quote_amount, meme_amount=meme_amount)
    if quote_amount > INT128_MAX or meme_amount > INT128_MAX:
        raise ValueError("graduation amount exceeds the V4 signed delta bound")
    quote_is_currency0 = quote_value < token_value
    amount0, amount1 = (
        (quote_amount, meme_amount)
        if quote_is_currency0
        else (meme_amount, quote_amount)
    )
    sqrt_price = sqrt_price_x96_from_amounts(amount0, amount1)
    if sqrt_price <= MIN_SQRT_PRICE or sqrt_price >= MAX_SQRT_PRICE:
        raise ValueError("graduation sqrt price is outside the strict V4 range")
    tick_lower, tick_upper = full_range_ticks(tick_spacing)
    liquidity = liquidity_for_amounts(
        sqrt_price,
        sqrt_price_at_tick(tick_lower),
        sqrt_price_at_tick(tick_upper),
        amount0,
        amount1,
    )
    maximum_liquidity = max_liquidity_per_tick(tick_spacing)
    if liquidity == 0 or liquidity > maximum_liquidity:
        raise ValueError("graduation seed is not viable")
    return GraduationSeed(
        quote_is_currency0=quote_is_currency0,
        amount0=amount0,
        amount1=amount1,
        sqrt_price_x96=sqrt_price,
        tick_lower=tick_lower,
        tick_upper=tick_upper,
        liquidity=liquidity,
        max_liquidity_per_tick=maximum_liquidity,
    )


def _hex_bytes(value: str, expected_length: int) -> bytes:
    raw = bytes.fromhex(value.removeprefix("0x"))
    if len(raw) != expected_length:
        raise ValueError(f"expected {expected_length} bytes")
    return raw


def quote_economics_hash(
    chain_id: int,
    pons_baseline_id: str,
    quote_asset: str,
    quote_decimals: int,
    phantom_quote: int,
    graduation_threshold: int,
) -> str:
    """Content-address one immutable V1 Quote configuration."""

    from spec.generate_v1_hash_vectors import keccak256

    _require_uint(
        chain_id=chain_id,
        quote_decimals=quote_decimals,
        phantom_quote=phantom_quote,
        graduation_threshold=graduation_threshold,
    )
    if chain_id == 0 or not MIN_SUPPORTED_ASSET_DECIMALS <= quote_decimals <= MAX_SUPPORTED_ASSET_DECIMALS:
        raise ValueError("unsupported Quote chain or decimals")
    if phantom_quote == 0 or graduation_threshold == 0:
        raise ValueError("Quote economics must be positive")
    domain = keccak256(QUOTE_ECONOMICS_DOMAIN_LABEL.encode())
    encoded = b"".join(
        (
            domain,
            (1).to_bytes(32, "big"),
            chain_id.to_bytes(32, "big"),
            _hex_bytes(pons_baseline_id, 32),
            _hex_bytes(quote_asset, 20).rjust(32, b"\x00"),
            quote_decimals.to_bytes(32, "big"),
            phantom_quote.to_bytes(32, "big"),
            graduation_threshold.to_bytes(32, "big"),
        )
    )
    return "0x" + keccak256(encoded).hex()


def minimum_nonzero_stock_position(stock_decimals: int) -> int:
    """Legacy V1-EXEC-1/3 helper retained only for retired research artifacts."""

    if not MIN_SUPPORTED_ASSET_DECIMALS <= stock_decimals <= MAX_SUPPORTED_ASSET_DECIMALS:
        raise ValueError("unsupported Stock decimals")
    return 10**stock_decimals // 2 + 1


def stake_saturation_amount(stock_decimals: int) -> int:
    """Legacy V1-EXEC-3 helper retained only for retired research artifacts."""

    if not MIN_SUPPORTED_ASSET_DECIMALS <= stock_decimals <= MAX_SUPPORTED_ASSET_DECIMALS:
        raise ValueError("unsupported Stock decimals")
    return LEGACY_STAKE_SATURATION_WHOLE_TOKENS * 10**stock_decimals


def validate_minimum_allocation(stock_decimals: int, minimum_allocation: int) -> int:
    """Validate one V1-EXEC-10 per-asset minimum in canonical raw units."""

    if not MIN_SUPPORTED_ASSET_DECIMALS <= stock_decimals <= MAX_SUPPORTED_ASSET_DECIMALS:
        raise ValueError("unsupported Stock decimals")
    _require_uint(minimum_allocation=minimum_allocation)
    if minimum_allocation < MINIMUM_SAFE_ALLOCATION_RAW:
        raise ValueError("minimum allocation is below the accumulator safety floor")
    return minimum_allocation


@dataclass(frozen=True)
class AccumulatorLifetimeBound:
    minimum_active_stock: int
    maximum_reward_per_credit: int
    maximum_credits: int
    maximum_accumulator_delta: int
    maximum_accumulator: int
    uint256_headroom_factor: int


def accumulator_lifetime_bound() -> AccumulatorLifetimeBound:
    """Prove the base fee-credit index bound for every V1-EXEC-10 asset."""

    minimum_active = MINIMUM_SAFE_ALLOCATION_RAW
    maximum_carry = (MAX_ACCOUNTING_AMOUNT - 1) // minimum_active
    maximum_whole = mul_div_floor(
        MAX_ACCOUNTING_AMOUNT, INDEX_PRECISION, minimum_active
    )
    maximum_delta = checked_add_uint256(maximum_carry, maximum_whole, 1)
    maximum_accumulator = checked_mul_uint256(
        maximum_delta, MAX_LIFETIME_FEE_CREDITS
    )
    return AccumulatorLifetimeBound(
        minimum_active_stock=minimum_active,
        maximum_reward_per_credit=MAX_ACCOUNTING_AMOUNT,
        maximum_credits=MAX_LIFETIME_FEE_CREDITS,
        maximum_accumulator_delta=maximum_delta,
        maximum_accumulator=maximum_accumulator,
        uint256_headroom_factor=UINT256_MAX // maximum_accumulator,
    )


def maximum_post_graduation_fee_base() -> int:
    """Largest base whose one-percent fee still fits the signed V4 delta."""

    return (INT128_MAX + 1) * (PIPS_DENOMINATOR // FEE_PIPS) - 1


def derive_component_salt(
    chain_id: int,
    factory: str,
    market_id: str,
    component_kind: str,
) -> bytes:
    """Derive the domain-separated salt used by every market component."""

    from spec.generate_v1_hash_vectors import keccak256

    if chain_id <= 0:
        raise ValueError("chain_id must be positive")
    domain = keccak256(COMPONENT_SALT_DOMAIN_LABEL.encode())
    kind = keccak256(component_kind.encode())
    encoded = b"".join(
        (
            domain,
            (1).to_bytes(32, "big"),
            chain_id.to_bytes(32, "big"),
            _hex_bytes(factory, 20).rjust(32, b"\x00"),
            _hex_bytes(market_id, 32),
            kind,
        )
    )
    return keccak256(encoded)


def predict_create2_address(
    launch_deployer: str, component_salt: bytes, init_code_hash: str
) -> str:
    """Apply EIP-1014 CREATE2 address derivation."""

    from spec.generate_v1_hash_vectors import keccak256

    if len(component_salt) != 32:
        raise ValueError("component_salt must be bytes32")
    payload = b"".join(
        (
            b"\xff",
            _hex_bytes(launch_deployer, 20),
            component_salt,
            _hex_bytes(init_code_hash, 32),
        )
    )
    return "0x" + keccak256(payload)[-20:].hex()


@dataclass(frozen=True)
class PoolFeePartition:
    base: int
    active_stock: int
    total: int
    lp: int
    non_lp: int
    creator: int
    staker: int
    platform: int


def partition_pool_fee(base: int, active_stock: int) -> PoolFeePartition:
    """Partition a V1-EXEC-10 pool fee with no LP leg and fixed beneficiary shares."""

    _require_uint(base=base, active_stock=active_stock)
    if base > maximum_post_graduation_fee_base():
        raise ValueError("fee base exceeds the V4 signed delta accounting bound")
    if active_stock > MAX_ACCOUNTING_AMOUNT:
        raise ValueError("Stock accounting amount exceeds int128.max")

    total = mul_div_floor(base, FEE_PIPS, PIPS_DENOMINATOR)
    lp = mul_div_floor(total, LP_SHARE_BPS, BPS_DENOMINATOR)
    non_lp = total - lp
    staker = (
        mul_div_floor(non_lp, STAKER_NON_LP_SHARE_BPS, BPS_DENOMINATOR)
        if active_stock != 0
        else 0
    )
    platform = mul_div_floor(non_lp, PLATFORM_NON_LP_SHARE_BPS, BPS_DENOMINATOR)
    creator = non_lp - staker - platform
    return PoolFeePartition(
        base=base,
        active_stock=active_stock,
        total=total,
        lp=lp,
        non_lp=non_lp,
        creator=creator,
        staker=staker,
        platform=platform,
    )


def partition_pool_fee_linear_legacy(
    base: int, active_stock: int, saturation_amount: int
) -> PoolFeePartition:
    """Retired V1-EXEC-1/3 model used only by historical backing-target tooling."""

    _require_uint(base=base, active_stock=active_stock, saturation_amount=saturation_amount)
    if saturation_amount == 0:
        raise ValueError("saturation_amount must be positive")
    if base > maximum_post_graduation_fee_base():
        raise ValueError("fee base exceeds the V4 signed delta accounting bound")
    if active_stock > MAX_ACCOUNTING_AMOUNT or saturation_amount > MAX_ACCOUNTING_AMOUNT:
        raise ValueError("legacy accounting amount exceeds int128.max")

    total = mul_div_floor(base, FEE_PIPS, PIPS_DENOMINATOR)
    lp = mul_div_floor(total, LEGACY_LP_SHARE_BPS, BPS_DENOMINATOR)
    non_lp = total - lp
    staker = mul_div_floor(non_lp, min(active_stock, saturation_amount), 2 * saturation_amount)
    remaining = non_lp - staker
    creator = remaining // 2
    platform = remaining - creator
    return PoolFeePartition(
        base=base,
        active_stock=active_stock,
        total=total,
        lp=lp,
        non_lp=non_lp,
        creator=creator,
        staker=staker,
        platform=platform,
    )


@dataclass(frozen=True)
class CurveFeePartition:
    total: int
    creator: int
    platform: int


def partition_curve_fee(total: int) -> CurveFeePartition:
    """Split curve fees 70/30, assigning every indivisible residual unit to Creator."""

    _require_uint(total=total)
    platform = mul_div_floor(total, PLATFORM_NON_LP_SHARE_BPS, BPS_DENOMINATOR)
    return CurveFeePartition(total=total, creator=total - platform, platform=platform)


@dataclass(frozen=True)
class IndexCredit:
    accumulator_delta: int
    new_index_remainder: int


def credit_pool_index(
    reward: int,
    active_stock: int,
    previous_index_remainder: int,
    precision: int = INDEX_PRECISION,
) -> IndexCredit:
    """Credit a Gauge index while preserving its scaled numerator exactly."""

    _require_uint(
        reward=reward,
        active_stock=active_stock,
        previous_index_remainder=previous_index_remainder,
    )
    if active_stock == 0:
        raise ValueError("active_stock must be positive for an index credit")
    if reward > MAX_ACCOUNTING_AMOUNT or active_stock > MAX_ACCOUNTING_AMOUNT:
        raise ValueError("Gauge accounting amount exceeds int128.max")
    if precision <= 0:
        raise ValueError("precision must be positive")

    carry, normalized = divmod(previous_index_remainder, active_stock)
    whole, fraction = mul_div_with_remainder(reward, precision, active_stock)
    if fraction == 0 or normalized < active_stock - fraction:
        extra = 0
        new_remainder = normalized + fraction
    else:
        extra = 1
        new_remainder = normalized - (active_stock - fraction)
    return IndexCredit(
        accumulator_delta=checked_add_uint256(carry, whole, extra),
        new_index_remainder=new_remainder,
    )


@dataclass(frozen=True)
class UserSettlement:
    newly_claimable: int
    total_claimable: int
    new_user_remainder: int
    new_accumulator_paid: int


def settle_user_reward(
    active_stock: int,
    current_accumulator: int,
    accumulator_paid: int,
    previous_claimable: int,
    previous_user_remainder: int,
    precision: int = INDEX_PRECISION,
) -> UserSettlement:
    """Settle one user/market/fee-asset accumulator with sub-unit carry."""

    _require_uint(
        active_stock=active_stock,
        current_accumulator=current_accumulator,
        accumulator_paid=accumulator_paid,
        previous_claimable=previous_claimable,
        previous_user_remainder=previous_user_remainder,
    )
    if precision <= 0:
        raise ValueError("precision must be positive")
    if active_stock > MAX_ACCOUNTING_AMOUNT:
        raise ValueError("active_stock exceeds int128.max")
    if current_accumulator < accumulator_paid:
        raise ValueError("accumulator cannot decrease")
    if previous_user_remainder >= precision:
        raise ValueError("previous_user_remainder must be less than precision")

    delta = current_accumulator - accumulator_paid
    whole, fraction = mul_div_with_remainder(active_stock, delta, precision)
    carried, new_remainder = divmod(
        checked_add_uint256(previous_user_remainder, fraction), precision
    )
    newly_claimable = checked_add_uint256(whole, carried)
    return UserSettlement(
        newly_claimable=newly_claimable,
        total_claimable=checked_add_uint256(previous_claimable, newly_claimable),
        new_user_remainder=new_remainder,
        new_accumulator_paid=current_accumulator,
    )


@dataclass(frozen=True)
class ActivationSlot:
    generation: int = 0
    amount: int = 0
    refs: int = 0


@dataclass(frozen=True)
class ProcessedActivation:
    generation: int
    amount: int
    refs: int


def empty_activation_wheel() -> tuple[ActivationSlot, ...]:
    return tuple(ActivationSlot() for _ in range(ACTIVATION_WHEEL_SIZE))


def _validate_wheel(slots: tuple[ActivationSlot, ...]) -> None:
    if len(slots) != ACTIVATION_WHEEL_SIZE:
        raise ValueError("activation wheel must have exactly 32 slots")
    for index, slot in enumerate(slots):
        _require_uint(64, generation=slot.generation, refs=slot.refs)
        _require_uint(amount=slot.amount)
        if slot.generation == 0:
            if slot.amount != 0 or slot.refs != 0:
                raise ValueError(f"empty slot {index} contains state")
        elif slot.amount == 0 or slot.refs == 0:
            raise ValueError(f"live slot {index} must have amount and refs")
        elif slot.generation % ACTIVATION_WHEEL_SIZE != index:
            raise ValueError(f"slot {index} has the wrong generation residue")


def process_mature_activations(
    slots: tuple[ActivationSlot, ...], now: int
) -> tuple[tuple[ActivationSlot, ...], tuple[ProcessedActivation, ...]]:
    """Scan exactly 32 slots and clear generations due at or before ``now``."""

    _require_uint(64, now=now)
    _validate_wheel(slots)
    updated = list(slots)
    processed = []
    for index in range(ACTIVATION_WHEEL_SIZE):
        slot = updated[index]
        if slot.generation != 0 and slot.generation <= now:
            processed.append(
                ProcessedActivation(slot.generation, slot.amount, slot.refs)
            )
            updated[index] = ActivationSlot()
    return tuple(updated), tuple(processed)


def add_activation_bucket(
    slots: tuple[ActivationSlot, ...], generation: int, amount: int, refs: int = 1
) -> tuple[ActivationSlot, ...]:
    """Register or aggregate one absolute generation, failing closed on collision."""

    _validate_wheel(slots)
    _require_uint(64, generation=generation, refs=refs)
    _require_uint(amount=amount)
    if generation <= 0 or amount <= 0 or refs <= 0:
        raise ValueError("generation, amount and refs must be positive")
    index = generation % ACTIVATION_WHEEL_SIZE
    current = slots[index]
    if current.generation not in (0, generation):
        raise ValueError("ActivationSlotCollision")
    new_refs = checked_add_uint256(current.refs, refs)
    _require_uint(64, new_refs=new_refs)
    updated = list(slots)
    updated[index] = ActivationSlot(
        generation=generation,
        amount=checked_add_uint256(current.amount, amount),
        refs=new_refs,
    )
    return tuple(updated)


def remove_activation_position(
    slots: tuple[ActivationSlot, ...], generation: int, amount: int
) -> tuple[ActivationSlot, ...]:
    """Remove one user's unprocessed pending position before a reset."""

    _validate_wheel(slots)
    _require_uint(64, generation=generation)
    _require_uint(amount=amount)
    if generation <= 0 or amount <= 0:
        raise ValueError("generation and amount must be positive")
    index = generation % ACTIVATION_WHEEL_SIZE
    current = slots[index]
    if current.generation != generation or current.amount < amount or current.refs == 0:
        raise ValueError("pending position is not present")
    new_amount = current.amount - amount
    new_refs = current.refs - 1
    if (new_amount == 0) != (new_refs == 0):
        raise ValueError("bucket amount/ref invariant would be broken")
    updated = list(slots)
    updated[index] = (
        ActivationSlot()
        if new_refs == 0
        else ActivationSlot(generation, new_amount, new_refs)
    )
    return tuple(updated)


def schedule_new_pending(
    slots: tuple[ActivationSlot, ...], now: int, amount: int
) -> tuple[tuple[ActivationSlot, ...], int]:
    """Process mature buckets, then schedule ``now + 30`` as the protocol does."""

    _require_uint(64, now=now)
    if now > UINT64_MAX - ACTIVATION_DELAY_SECONDS:
        raise ValueError("activation timestamp overflows uint64")
    processed_slots, _ = process_mature_activations(slots, now)
    due = now + ACTIVATION_DELAY_SECONDS
    return add_activation_bucket(processed_slots, due, amount), due
