#!/usr/bin/env python3
"""Illustrated placeholder avatars for the landing-page screenshots.

Stand-ins for the claimed ravers in scripts/capture-landing-screenshots.js
until real crew photos (with permission) replace them: drop a <name>.jpg/.webp
here and point AVATARS in the capture script at it. Run: python3 make-avatars.py
"""
import os

OUT = os.path.dirname(os.path.abspath(__file__))

SKIN = {'light': '#F6D3B8', 'lmed': '#E8B48F', 'med': '#C98E64', 'tan': '#B27850', 'brown': '#8D5A3B', 'deep': '#5E3A26'}


def face(skin, eyes='dots'):
    s = SKIN[skin]
    parts = [
        f'<rect x="113" y="150" width="30" height="34" rx="10" fill="{s}"/>',            # neck
        f'<ellipse cx="128" cy="118" rx="50" ry="56" fill="{s}"/>',                     # head
        f'<ellipse cx="78" cy="122" rx="9" ry="13" fill="{s}"/><ellipse cx="178" cy="122" rx="9" ry="13" fill="{s}"/>',  # ears
        '<circle cx="101" cy="138" r="8" fill="#FF6BA8" opacity=".35"/><circle cx="155" cy="138" r="8" fill="#FF6BA8" opacity=".35"/>',
        '<path d="M112 144 Q128 158 144 144" stroke="#3A1F1A" stroke-width="5" fill="none" stroke-linecap="round"/>',
    ]
    if eyes == 'dots':
        parts.append('<circle cx="108" cy="120" r="6" fill="#1E1420"/><circle cx="148" cy="120" r="6" fill="#1E1420"/>')
    return ''.join(parts)


def body(color):
    return f'<path d="M40 256 Q44 186 128 180 Q212 186 216 256 Z" fill="{color}"/>'


def svg(name, bg, inner):
    a, b = bg
    doc = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{a}"/><stop offset="1" stop-color="{b}"/></linearGradient></defs>
<rect width="256" height="256" fill="url(#g)"/>
{inner}
</svg>
'''
    with open(os.path.join(OUT, f'{name}.svg'), 'w') as f:
        f.write(doc)


SHADES = ('<rect x="90" y="108" width="34" height="24" rx="12" fill="{c}"/><rect x="132" y="108" width="34" height="24" rx="12" fill="{c}"/>'
          '<rect x="122" y="116" width="12" height="5" fill="{c}"/>'
          '<rect x="96" y="112" width="10" height="5" rx="2" fill="#fff" opacity=".55"/><rect x="138" y="112" width="10" height="5" rx="2" fill="#fff" opacity=".55"/>')
GLITTER = ''.join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="#fff" opacity=".9"/>' for x, y, r in
                  [(94, 134, 2.5), (100, 128, 1.6), (88, 128, 1.4), (162, 134, 2.5), (156, 128, 1.6), (168, 129, 1.4)])

# Alex (you): short dark hair, pink shades
svg('alex', ('#FF2D78', '#BF00FF'),
    body('#111018') + face('med', eyes=None) +
    '<path d="M76 104 Q78 56 128 56 Q180 56 180 104 Q166 82 128 84 Q96 84 76 104 Z" fill="#20130F"/>' +
    SHADES.format(c='#FF2D78'))

# Dani: long purple waves, glitter cheeks
svg('dani', ('#00F5FF', '#39FF14'),
    '<path d="M70 120 Q60 60 128 54 Q198 60 186 124 Q196 190 172 200 L84 200 Q60 186 70 120 Z" fill="#8E2DE2"/>' +
    body('#1A0F2B') + face('lmed') +
    '<path d="M78 112 Q86 60 128 60 Q170 60 178 112 Q156 78 128 80 Q104 80 78 112 Z" fill="#A445F0"/>' + GLITTER)

# Tess: blonde space buns, star gem
svg('tess', ('#FFD600', '#FF2D78'),
    '<circle cx="86" cy="66" r="24" fill="#F2C94C"/><circle cx="170" cy="66" r="24" fill="#F2C94C"/>' +
    body('#2B0F1E') + face('light') +
    '<path d="M78 108 Q84 62 128 62 Q172 62 178 108 Q160 84 128 86 Q98 86 78 108 Z" fill="#F2C94C"/>' +
    '<path d="M128 92 l4 8 9 1-7 6 2 9-8-5-8 5 2-9-7-6 9-1z" fill="#00F5FF"/>')

# Kai: buzz cut under a cyan bucket hat
svg('kai', ('#BF00FF', '#FF2D78'),
    body('#0E1A1C') + face('deep') +
    '<path d="M70 98 Q74 52 128 50 Q184 52 186 98 Z" fill="#00C2CC"/><rect x="58" y="92" width="140" height="14" rx="7" fill="#00A6AE"/>')

# Marco: curly hair, beard, green bandana
svg('marco', ('#39FF14', '#00F5FF'),
    body('#0F1A10') + face('tan') +
    ''.join(f'<circle cx="{x}" cy="{y}" r="15" fill="#1A1210"/>' for x, y in
            [(88, 80), (108, 66), (128, 62), (148, 66), (168, 80), (80, 98), (176, 98)]) +
    '<rect x="78" y="88" width="100" height="12" rx="6" fill="#39FF14"/>' +
    '<path d="M86 132 Q90 176 128 178 Q166 176 170 132 Q156 150 128 150 Q100 150 86 132 Z" fill="#1A1210"/>' +
    '<path d="M114 146 Q128 156 142 146" stroke="#F6E7DA" stroke-width="4" fill="none" stroke-linecap="round"/>')

# Priya: long black hair, glowing headband, hoops
svg('priya', ('#FF6BA8', '#FFD600'),
    '<path d="M68 122 Q60 58 128 54 Q196 58 188 122 L192 206 L64 206 Z" fill="#141018"/>' +
    body('#2A1022') + face('brown') +
    '<path d="M78 110 Q84 62 128 62 Q172 62 178 110 Q150 86 128 86 Q106 86 78 110 Z" fill="#141018"/>' +
    '<path d="M82 92 Q128 64 174 92" stroke="#00F5FF" stroke-width="6" fill="none" stroke-linecap="round"/>' +
    '<circle cx="76" cy="146" r="9" stroke="#FFD600" stroke-width="3" fill="none"/><circle cx="180" cy="146" r="9" stroke="#FFD600" stroke-width="3" fill="none"/>')

print('wrote 6 avatars to', OUT)
