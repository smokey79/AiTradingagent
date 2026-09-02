# src/utils/slippage_control.py
# Calculates minimum acceptable output after slippage

def calculate_min_amount_out(amount_in: int, slippage: float = 0.01) -> int:
    """
    Returns the minimum acceptable output amount after slippage.
    
    Args:
        amount_in: Token amount going in (in smallest unit, e.g. wei)
        slippage: Decimal slippage tolerance e.g. 0.01 = 1%
    
    Returns:
        Minimum output amount as integer
    
    Example:
        calculate_min_amount_out(1000, 0.01) → 990
    """
    if not 0 < slippage < 1:
        raise ValueError("Slippage must be between 0 and 1 (e.g. 0.01 for 1%)")

    min_out = int(amount_in * (1 - slippage))
    print(f"[SLIPPAGE] In: {amount_in} | Tolerance: {slippage*100}% | Min out: {min_out}")
    return min_out
