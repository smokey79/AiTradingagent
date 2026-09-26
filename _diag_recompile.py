import py_compile, sys
try:
    py_compile.compile('bridge/python_to_node.py', doraise=True)
    print('OK - compiles cleanly')
except Exception as e:
    print('FAILED:', repr(e))

# Also try the actual import exactly as arbitrage_scanner.py does it
sys.path.insert(0, '.')
try:
    from bridge.python_to_node import BridgePublisher
    print('IMPORT OK')
except Exception as e:
    print('IMPORT FAILED:', repr(e))
