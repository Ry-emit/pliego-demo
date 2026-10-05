#!/usr/bin/env python3
"""Pliego demo server: static files from this folder. Code is never cached, photos are."""
import http.server
import os
import sys

IMAGES = ('.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif')


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        if not self.path.lower().split('?')[0].endswith(IMAGES):
            self.send_header('Cache-Control', 'no-cache, must-revalidate')
        super().end_headers()

    def log_message(self, *args):
        pass


os.chdir(os.path.dirname(os.path.abspath(__file__)))
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8245
http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
