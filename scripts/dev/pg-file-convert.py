#!/usr/bin/env python3
"""单仓储文件 PG 方言手工转换辅助器(M3.8-2)。
按序执行:① prepare→await db.get/all/run 变参 ② @named→位置参数展开
③ INSERT OR IGNORE→ON CONFLICT DO NOTHING ④ 函数体含 await 补 async
⑤ 返回类型注解包 Promise ⑥ 函数间补空行。每步括号匹配,不确定处原样保留。
"""
import sys, re

def match_delim(text, start, open_ch, close_ch):
    depth, i, in_str = 0, start, None
    while i < len(text):
        ch = text[i]
        if in_str:
            if ch == '\\':
                i += 2
                continue
            if ch == in_str:
                in_str = None
        elif ch in ('"', "'", '`'):
            in_str = ch
        elif ch == open_ch:
            depth += 1
        elif ch == close_ch:
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1

def convert(text):
    # ① prepare 调用链 → 变参
    def prep_repl(m):
        sql = m.group(1)
        method = m.group(2)
        params = m.group(3).strip()
        call = f'await db.{method}({sql}'
        if params:
            call += f', {params}'
        call += ')'
        if method == 'run':
            call = f'({call}).changes'
        return call
    text = re.sub(
        r'db\s*\.\s*prepare\s*\(\s*(`[^`]*`)\s*\)\s*\.\s*(get|all|run)\s*\(([^)]*)\)',
        prep_repl,
        text,
        flags=re.DOTALL,
    )
    # ② @named → ? + 展开参数
    def named_repl(m):
        sql, obj = m.group(1), m.group(2)
        names = re.findall(r'@([A-Za-z_][\w$]*)', sql)
        if not names:
            return m.group(0)
        new_sql = re.sub(r'@([A-Za-z_][\w$]*)', '?', sql)
        args = ', '.join(f'{obj}.{n}' for n in names)
        return f'await db.run(`{new_sql}`, {args})'
    text = re.sub(r'await db\.run\(\s*`([^`]*)`\s*,\s*([A-Za-z_$][\w$]*)\s*\)', named_repl, text, flags=re.DOTALL)
    # ③ INSERT OR IGNORE
    text = text.replace('INSERT OR IGNORE INTO', 'INSERT INTO')
    text = re.sub(r'(INSERT INTO \w+[^`]*?VALUES[^`]*?)(\)\s*`)', r'\1\n  ON CONFLICT DO NOTHING\2', text, flags=re.DOTALL)
    # ⑥ 函数间空行
    text = re.sub(r'\}(?=(?:export\s+)?(?:async\s+)?function\b)', '}\n\n', text)
    return text

def asyncify(text):
    result = []
    cursor = 0
    changed = False
    for m in re.finditer(r'(?:^|[\n;}])\s*((?:export\s+)?(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\()', text):
        decl_start = m.start(1)
        if decl_start < cursor:
            continue
        open_paren = m.end() - 1
        decl = text[decl_start:open_paren]
        close_paren = match_delim(text, open_paren, '(', ')')
        if close_paren == -1:
            continue
        brace = text.find('{', close_paren)
        if brace == -1:
            continue
        close_brace = match_delim(text, brace, '{', '}')
        if close_brace == -1:
            continue
        body = text[brace:close_brace]
        needs = ('await ' in body) or ('await(' in body)
        annot = text[close_paren + 1:brace]
        already = text[max(0, decl_start - 6):decl_start].rstrip().endswith('async')
        needs_promise = needs and re.match(r'^\s*:\s*(?!\s*Promise<)(.+)$', annot, re.DOTALL) is not None
        result.append(text[cursor:decl_start])
        if needs and not already:
            if decl.startswith('export'):
                result.append('export ')
                result.append('async ')
                result.append(text[decl_start + len('export '):close_paren + 1])
            else:
                result.append('async ')
                result.append(text[decl_start:close_paren + 1])
            changed = True
        else:
            result.append(text[decl_start:close_paren + 1])
        if needs_promise:
            m_annot = re.match(r'^\s*:\s*(.+)$', annot, re.DOTALL)
            result.append(': Promise<' + m_annot.group(1).strip() + '>')
        else:
            result.append(annot)
        result.append(text[brace:close_brace + 1])
        cursor = close_brace + 1
    result.append(text[cursor:])
    return ''.join(result), changed

def process(path):
    s = open(path, encoding='utf-8').read()
    s = convert(s)
    s, changed = asyncify(s)
    if changed or True:
        open(path, 'w', encoding='utf-8').write(s)
    print(('CHANGED ' if changed else 'same    ') + path)

if __name__ == '__main__':
    for path in sys.argv[1:]:
        process(path)
