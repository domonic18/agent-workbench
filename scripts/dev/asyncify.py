#!/usr/bin/env python3
"""给 async 函数的同步返回类型注解包裹 Promise<T>(M3.8-2 存储层迁移工具)。"""
import sys, re

def match_brace(text, start):
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
        elif ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1

def match_paren(text, start):
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
        elif ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1

FN_RE = re.compile(r'(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(')

def asyncify_text(text):
    result = []
    cursor = 0
    changed = False
    last_end = 0
    for m in FN_RE.finditer(text):
        decl_start = m.start()
        if decl_start < last_end:
            continue
        open_paren = m.end() - 1
        close_paren = match_paren(text, open_paren)
        if close_paren == -1:
            continue
        brace = text.find('{', close_paren)
        if brace == -1:
            continue
        close_brace = match_brace(text, brace)
        if close_brace == -1:
            continue
        last_end = close_brace + 1
        body = text[brace:close_brace]
        needs = ('await ' in body) or ('await(' in body)
        annot = text[close_paren + 1:brace]
        already_async = 'async ' in text[m.start():open_paren]
        needs_promise = needs and re.match(r'^\s*:\s*(?!\s*Promise<)(.+)$', annot, re.DOTALL) is not None
        if not needs_promise:
            continue
        result.append(text[cursor:close_paren + 1])
        m_annot = re.match(r'^\s*:\s*(.+)$', annot, re.DOTALL)
        result.append(': Promise<' + m_annot.group(1).strip() + '>')
        result.append(text[brace:close_brace + 1])
        cursor = close_brace + 1
        changed = True
    result.append(text[cursor:])
    return ''.join(result), changed

def process(path):
    s = open(path, encoding='utf-8').read()
    new, changed = asyncify_text(s)
    if new != s:
        open(path, 'w', encoding='utf-8').write(new)
    return changed

if __name__ == '__main__':
    for path in sys.argv[1:]:
        print(('CHANGED ' if process(path) else 'same    ') + path)
