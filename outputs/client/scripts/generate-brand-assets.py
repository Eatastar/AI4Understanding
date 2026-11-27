"""Render the AI4U SVG into the checked-in desktop branding assets."""

import argparse
import json
import os
import subprocess
from pathlib import Path
from shutil import which
from tempfile import TemporaryDirectory

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
LOGO = ROOT / 'public' / 'assets' / 'ai4u-logo.svg'
DESTINATION = ROOT / 'desktop'
ICON_SIZES = (16, 24, 32, 48, 64, 128, 256)


def find_browser():
    for name in ('chromium', 'google-chrome', 'chrome', 'msedge'):
        browser = which(name)
        if browser:
            return browser
    if os.name == 'nt':
        program_files = os.environ.get('ProgramFiles(x86)', 'C:/Program Files (x86)')
        browser = Path(program_files) / 'Microsoft' / 'Edge' / 'Application' / 'msedge.exe'
        if browser.is_file():
            return str(browser)
    return None


def render_logo(browser):
    with TemporaryDirectory(prefix='ai4u-brand-') as temporary:
        directory = Path(temporary).resolve()
        html = directory / 'logo.html'
        html.write_text(
            '<!doctype html><meta charset="UTF-8"><style>html,body{margin:0;overflow:hidden}'
            'svg{display:block;width:512px;height:512px}</style>' + LOGO.read_text(encoding='utf-8'),
            encoding='utf-8',
        )
        raster = directory / 'logo.png'
        subprocess.run([
            browser, '--headless', '--disable-gpu', '--disable-background-networking',
            '--no-first-run', '--hide-scrollbars', '--force-device-scale-factor=1',
            '--window-size=512,512', '--default-background-color=00000000',
            f'--user-data-dir={directory / "profile"}', f'--screenshot={raster}', html.as_uri(),
        ], check=True, timeout=45, stdout=subprocess.DEVNULL)
        with Image.open(raster) as source:
            image = source.convert('RGBA')
    if image.size != (512, 512) or image.getpixel((0, 0))[3] != 0:
        raise RuntimeError('Expected a 512×512 logo with transparent corners')
    return image


def write_splash(logo):
    name = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['productName']
    splash = Image.new('RGB', (520, 300), '#fff8e7')
    mark = logo.resize((88, 88), Image.Resampling.LANCZOS)
    splash.paste(mark, ((splash.width - mark.width) // 2, 41), mark)
    label = ImageDraw.Draw(splash)
    label.text((260, 160), name, font=ImageFont.load_default(size=22), fill='#403526', anchor='mm')
    label.text((260, 197), 'Opening your reading space…', font=ImageFont.load_default(size=13), fill='#6c5a3f', anchor='mm')
    splash.save(DESTINATION / 'splash.bmp')


def write_icons(logo):
    # Give small Windows icons more room for the lettering inside the book.
    compact = logo.crop((88, 108, 424, 444))
    mask = Image.new('L', compact.size)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, compact.width - 1, compact.height - 1), radius=64, fill=255)
    compact.putalpha(mask)
    sizes = [(size, size) for size in ICON_SIZES]
    frames = [(compact if size[0] <= 32 else logo).resize(size, Image.Resampling.LANCZOS) for size in sizes]
    logo.save(DESTINATION / 'icon.png')
    frames[-1].save(DESTINATION / 'icon.ico', sizes=sizes, append_images=frames[:-1])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser', help='Path to a Chromium-based browser for offline SVG rendering')
    args = parser.parse_args()
    browser = args.browser or find_browser()
    if not browser:
        parser.error('Pass the path to a Chromium-based browser with --browser')
    logo = render_logo(browser)
    write_icons(logo)
    write_splash(logo)


if __name__ == '__main__':
    main()
