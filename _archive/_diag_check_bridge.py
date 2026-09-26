import ast

path = r"F:\aitradingagent\bridge\python_to_node.py"
with open(path, "rb") as f:
    raw = f.read()

print("first 40 bytes:", raw[:40])
print("length:", len(raw))

text = raw.decode("utf-8")
try:
    ast.parse(text)
    print("PARSE OK")
except SyntaxError as e:
    print("SYNTAX ERROR:", e)
    print("line", e.lineno, "offset", e.offset)
    lines = text.splitlines()
    for i in range(max(0, e.lineno - 3), min(len(lines), e.lineno + 2)):
        print(repr(lines[i]))
