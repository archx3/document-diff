"""Rewrite invisible / ambiguous characters in source files as \\uXXXX escapes.

Keeps TypeScript sources readable: non-breaking spaces, zero-width characters,
soft hyphens, private-use glyphs and U+FFFC become explicit escapes.
Usage: python3 scripts/escape_invisible.py <files...>
"""
import sys
import unicodedata

def needs_escape(ch: str) -> bool:
    if ch in '\t\n\r':
        return False
    if ch == '￼':
        return True
    cat = unicodedata.category(ch)
    return cat in ('Cc', 'Cf', 'Co', 'Zl', 'Zp') or (cat == 'Zs' and ch != ' ')

for path in sys.argv[1:]:
    with open(path, encoding='utf-8') as f:
        src = f.read()
    out = ''.join('\\u%04x' % ord(c) if needs_escape(c) else c for c in src)
    if out != src:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(out)
        print('escaped', path)
