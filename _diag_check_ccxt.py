try:
    import ccxt
    print("ccxt version:", ccxt.__version__)
except ImportError as e:
    print("NOT INSTALLED:", e)
