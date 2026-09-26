import py_compile

files = [
    r"F:\aitradingagent\core\llm_router.py",
    r"F:\aitradingagent\agents\debate_agent.py",
    r"F:\aitradingagent\src\flashloan\cross_chain_arbitrage.py",
    r"F:\aitradingagent\src\flashloan\flash_loan_executor.py",
    r"F:\aitradingagent\flashloan_scanner.py",
    r"F:\aitradingagent\scripts\debate_runner.py",
]

for f in files:
    try:
        py_compile.compile(f, doraise=True)
        print("OK:", f)
    except Exception as e:
        print("FAIL:", f, "->", e)
