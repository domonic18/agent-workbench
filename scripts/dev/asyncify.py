#!/usr/bin/env python3
"""给函数体含 await 的声明补 async(export 语序自动修正,函数间补空行)。"""
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

def asyncify_text(text):
    pieces = []
    last_end = 0
    for m in re.finditer(r'(?:^|[\n;}])\s*((?:export\s+)?function\s+[A-Za-z_$][\w$]*\s*\()', text):
        decl_start = m.start(1)
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
        body = text[brace:close_brace]
        decl = text[m.start(1):open_paren]
        already = text[max(0, decl_start - 6):decl_start].rstrip().endswith('async')
        needs = ('await ' in body) or ('await(' in body)
        pieces.append((decl_start, close_brace + 1, decl, needs, already, text[last_end:decl_start]))
        last_end = close_brace + 1

    result = []
    cursor = 0
    changed = False
    for decl_start, end, decl, needs, already, gap in pieces:
        if needs and not already:
            if decl.startswith('export'):
                insert_at = decl_start + len('export ')
                result.append(text[cursor:insert_at])
                result.append('async ')
            else:
                result.append(text[cursor:decl_start])
                result.append('async ')
            changed = True
        else:
            result.append(text[cursor:decl_start])
        result.append(text[decl_start:end])
        cursor = end
    result.append(text[cursor:])
    new = ''.join(result)
    new = re.sub(r'\}(?=(?:export\s+)?(?:async\s+)?function\b)', '}\n\n', new)
    return new, changed

def process(path):
    s = open(path, encoding='utf-8').read()
    new, changed = asyncify_text(s)
    if new != s:
        open(path, 'w', encoding='utf-8').write(new)
    return changed

if __name__ == '__main__':
    for path in sys.argv[1:]:
        print(('CHANGED ' if process(path) else 'same    ') + path)
