#!/usr/bin/env python3
"""better-sqlite3 同步调用 → async PG 适配器调用的机械转换器。
处理:db.prepare(SQL).get/all/run(PARAMS)[.changes][ as X]
     db.transaction(() => {...})();  → await db.transaction(async () => {...});
     db.exec(SQL)
不平衡括号的复杂调用原样保留,由 tsc 错误驱动手修。"""
import sys, re

def match_paren(text, start):
    """start 指向 '(';返回与之配对的 ')' 下标"""
    depth = 0
    i = start
    in_str = None
    while i < len(text):
        ch = text[i]
        if in_str:
            if ch == in_str:
                in_str = None
        elif ch in ('"', "'", '`'):
            in_str = ch
        elif ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1

def convert_prepare_calls(text):
    out = []
    i = 0
    needle_re = re.compile(r'db\s*\.\s*prepare\s*\(')
    while True:
        m0 = needle_re.search(text, i)
        if m0 is None:
            out.append(text[i:])
            break
        j = m0.start()
        open_paren = m0.end() - 1
        close_sql = match_paren(text, open_paren)
        if close_sql == -1:
            out.append(text[i:m0.end()])
            i = m0.end()
            continue
        sql_expr = text[open_paren+1:close_sql]
        # .get( / .all( / .run( 紧随
        m = re.match(r'\s*\.\s*(get|all|run)\s*\(', text[close_sql+1:], re.DOTALL)
        if not m:
            out.append(text[i:close_sql+1])
            i = close_sql + 1
            continue
        method = m.group(1)
        params_open = close_sql + 1 + m.end() - 1
        params_close = match_paren(text, params_open)
        if params_close == -1:
            out.append(text[i:close_sql+1])
            i = close_sql + 1
            continue
        params = text[params_open+1:params_close].strip()
        tail_start = params_close + 1
        tail = ''
        tm = re.match(r'\.changes', text[tail_start:])
        if tm:
            tail = '.changes'
            tail_start += tm.end()
        call = f'await db.{method}({sql_expr}' + (f', {params}' if params.strip() else '') + ')'
        if tail:
            call = f'({call}){tail}'
        out.append(text[i:j])
        out.append(call)
        i = tail_start
    return ''.join(out)

def convert_transactions(text):
    # db.transaction(() => { ... })(); → await db.transaction(async () => { ... });
    def repl(m):
        body = m.group(1)
        if 'async' in body.split('\n')[0]:
            return m.group(0)
        return f'await db.transaction(async () => {{ {body} }});'
    text = re.sub(r'db\.transaction\(\(\) => \{(.*?)\}\)\(\);', repl, text, flags=re.DOTALL)
    # 变体:db.transaction(() => { ... })(); 跨多行 → 上面已处理
    # 变体:const x = db.transaction(...)();  同一正则覆盖
    return text

def convert_exec(text):
    text = re.sub(r'(?<!await )db\.exec\(', 'await db.exec(', text)
    return text

def process(path):
    s = open(path, encoding='utf-8').read()
    orig = s
    s = convert_prepare_calls(s)
    s = convert_transactions(s)
    s = convert_exec(s)
    if s != orig:
        open(path, 'w', encoding='utf-8').write(s)
        return True
    return False

if __name__ == '__main__':
    for path in sys.argv[1:]:
        changed = process(path)
        print(('CHANGED ' if changed else 'same    ') + path)
