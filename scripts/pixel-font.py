"""Rebuild the original 5x7 Guild Pixel display face (requires fonttools).

Artwork is authored here; no third-party fonts or runtime downloads are used.
"""
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

LETTERS = {
    'A':'01110/10001/10001/11111/10001/10001/10001',
    'B':'11110/10001/10001/11110/10001/10001/11110',
    'C':'01111/10000/10000/10000/10000/10000/01111',
    'D':'11110/10001/10001/10001/10001/10001/11110',
    'E':'11111/10000/10000/11110/10000/10000/11111',
    'F':'11111/10000/10000/11110/10000/10000/10000',
    'G':'01111/10000/10000/10111/10001/10001/01111',
    'H':'10001/10001/10001/11111/10001/10001/10001',
    'I':'11111/00100/00100/00100/00100/00100/11111',
    'J':'00111/00010/00010/00010/10010/10010/01100',
    'K':'10001/10010/10100/11000/10100/10010/10001',
    'L':'10000/10000/10000/10000/10000/10000/11111',
    'M':'10001/11011/10101/10101/10001/10001/10001',
    'N':'10001/11001/11001/10101/10011/10011/10001',
    'O':'01110/10001/10001/10001/10001/10001/01110',
    'P':'11110/10001/10001/11110/10000/10000/10000',
    'Q':'01110/10001/10001/10001/10101/10010/01101',
    'R':'11110/10001/10001/11110/10100/10010/10001',
    'S':'01111/10000/10000/01110/00001/00001/11110',
    'T':'11111/00100/00100/00100/00100/00100/00100',
    'U':'10001/10001/10001/10001/10001/10001/01110',
    'V':'10001/10001/10001/10001/10001/01010/00100',
    'W':'10001/10001/10001/10101/10101/10101/01010',
    'X':'10001/10001/01010/00100/01010/10001/10001',
    'Y':'10001/10001/01010/00100/00100/00100/00100',
    'Z':'11111/00001/00010/00100/01000/10000/11111',
    '0':'01110/10001/10011/10101/11001/10001/01110',
    '1':'00100/01100/00100/00100/00100/00100/01110',
    '2':'01110/10001/00001/00110/01000/10000/11111',
    '3':'11110/00001/00001/01110/00001/00001/11110',
    '4':'00010/00110/01010/10010/11111/00010/00010',
    '5':'11111/10000/10000/11110/00001/00001/11110',
    '6':'01110/10000/10000/11110/10001/10001/01110',
    '7':'11111/00001/00010/00100/01000/01000/01000',
    '8':'01110/10001/10001/01110/10001/10001/01110',
    '9':'01110/10001/10001/01111/00001/00001/01110',
    "'":'00100/00100/01000/00000/00000/00000/00000',
    '&':'01100/10010/10100/01000/10101/10010/01101',
    '-':'00000/00000/00000/01110/00000/00000/00000',
    '.':'00000/00000/00000/00000/00000/00100/00100',
    ':':'00000/00100/00100/00000/00100/00100/00000',
    '?':'01110/10001/00001/00010/00100/00000/00100',
    '!':'00100/00100/00100/00100/00100/00000/00100',
    ' ':'00000/00000/00000/00000/00000/00000/00000',
}

def build():
    glyphs = {'.notdef': TTGlyphPen(None).glyph()}
    cmap = {}
    for character, pattern in LETTERS.items():
        name = f'pixel{ord(character):04x}'
        pen = TTGlyphPen(None)
        for row, bits in enumerate(pattern.split('/')):
            for column, bit in enumerate(bits):
                if bit != '1':
                    continue
                x, y = column * 100 + 50, (6-row) * 100
                pen.moveTo((x,y)); pen.lineTo((x,y+100))
                pen.lineTo((x+100,y+100)); pen.lineTo((x+100,y)); pen.closePath()
        glyphs[name] = pen.glyph()
        cmap[ord(character)] = name
        if character.isalpha():
            cmap[ord(character.lower())] = name
    font = FontBuilder(1000, isTTF=True)
    font.setupGlyphOrder(list(glyphs))
    font.setupCharacterMap(cmap)
    font.setupGlyf(glyphs)
    font.setupHorizontalMetrics({name:(600,50) for name in glyphs})
    font.setupHorizontalHeader(ascent=800, descent=-200)
    font.setupNameTable({'familyName':'Guild Pixel','styleName':'Regular',
        'uniqueFontIdentifier':'AlchemistGuildPixel1','fullName':'Guild Pixel',
        'psName':'GuildPixel-Regular','copyright':'Original artwork for The Alchemist\'s Shop.'})
    font.setupOS2(sTypoAscender=800,sTypoDescender=-200,usWinAscent=800,usWinDescent=200)
    font.setupPost(); font.setupMaxp(); font.font.flavor='woff'
    output = Path(__file__).resolve().parents[1]/'public/fonts/guild-pixel.woff'
    output.parent.mkdir(exist_ok=True)
    font.save(output)
    print(f'Wrote {output.name} ({output.stat().st_size} bytes)')

if __name__ == '__main__':
    build()
