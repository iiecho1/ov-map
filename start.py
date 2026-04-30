#!/usr/bin/env python3
import http.server
import socketserver
import webbrowser
import os

PORT = 8080
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

if __name__ == "__main__":
    with socketserver.TCPServer(("0.0.0.0", PORT), Handler) as httpd:
        print(f"网页版奥维地图已启动")
        print(f"本地访问: http://localhost:{PORT}")
        print(f"按 Ctrl+C 停止服务")
        webbrowser.open(f"http://localhost:{PORT}")
        httpd.serve_forever()
