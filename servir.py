#!/usr/bin/env python3
"""Pliego demo server: static files from this folder. Code is never cached, photos are."""
import http.server
import json
import os
import sys

IMAGES = ('.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif')
ROOT = os.path.dirname(os.path.abspath(__file__))
PHOTOS = os.path.join(ROOT, 'fotos')
PHOTO_LIST = os.path.join(PHOTOS, 'fotos.json')


def write_photo_list():
    """Keep fotos/fotos.json in step with the folder, so the site also finds its photos once published."""
    names = sorted(n for n in os.listdir(PHOTOS) if n.lower().endswith(IMAGES) and not n.startswith('.'))
    text = json.dumps(names, ensure_ascii=False, indent=2) + '\n'
    try:
        with open(PHOTO_LIST, encoding='utf-8') as f:
            if f.read() == text:
                return
    except FileNotFoundError:
        if not names:
            return
    with open(PHOTO_LIST, 'w', encoding='utf-8') as f:
        f.write(text)


class Handler(http.server.SimpleHTTPRequestHandler):
    def list_directory(self, path):
        if os.path.abspath(path) == PHOTOS:
            write_photo_list()
        return super().list_directory(path)

    def end_headers(self):
        if not self.path.lower().split('?')[0].endswith(IMAGES):
            self.send_header('Cache-Control', 'no-cache, must-revalidate')
        super().end_headers()

    def log_message(self, *args):
        pass


os.chdir(ROOT)
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8245
http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
