for mod in ["pandas", "numpy"]:
    try:
        m = __import__(mod)
        print(mod, "OK", getattr(m, "__version__", "?"))
    except ImportError as e:
        print(mod, "MISSING:", e)
