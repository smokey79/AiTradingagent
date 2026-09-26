import sys, os
sys.path.insert(0, os.path.abspath(os.path.join(r"F:\aitradingagent\src\flashloan", "../../")))
print("sys.path[0:3]:", sys.path[0:3])
print("PYTHONIOENCODING:", os.environ.get("PYTHONIOENCODING"))
print("default encoding:", sys.getdefaultencoding())
print("fs encoding:", sys.getfilesystemencoding())
import locale
print("locale:", locale.getpreferredencoding())
try:
    import bridge.python_to_node as m
    print("IMPORT OK:", m.__file__)
except SyntaxError as e:
    print("IMPORT SYNTAX ERROR:", e)
    import traceback; traceback.print_exc()
