"""Loopback-only local workspace with per-process request authentication."""
import argparse
import json
import mimetypes
from pathlib import Path
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
import webbrowser

from .repository import suggested_doc
from .service import Service


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--doc", default="")
    parser.add_argument("--open", action="store_true")
    args = parser.parse_args()
    service = Service()
    token = secrets.token_urlsafe(32)
    origin = f"http://127.0.0.1:{args.port}"
    root = Path(__file__).resolve().parents[1] / "dist"
    initial_error = ""
    doc = args.doc or suggested_doc()
    if doc:
        try:
            service.load(doc)
        except Exception as exc:
            initial_error = str(exc)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass  # Never log credentials or local business payloads.

        def respond(self, code, data):
            body = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def host_ok(self):
            return self.headers.get("Host") == f"127.0.0.1:{args.port}"

        def do_GET(self):
            if not self.host_ok():
                return self.respond(403, {"error": "仅允许本机入口"})
            path = urlsplit(self.path).path
            if path == "/api/bootstrap":
                if self.headers.get("Sec-Fetch-Site", "same-origin") not in {"same-origin", "none"}:
                    return self.respond(403, {"error": "禁止跨站读取"})
                return self.respond(200, {"app": "character-creator", "token": token, "suggestedDoc": doc,
                                          "initialError": initial_error, **service.summary()})
            if path.startswith("/api/"):
                if self.headers.get("X-Session-Token") != token:
                    return self.respond(403, {"error": "会话失效，请刷新面板"})
                try:
                    if path.startswith("/api/careers/"):
                        return self.respond(200, service.detail(path.rsplit("/", 1)[1]))
                    return self.respond(404, {"error": "接口不存在"})
                except (ValueError, OSError) as exc:
                    return self.respond(400, {"error": str(exc)})
            target = (root / path.lstrip("/")).resolve()
            if path == "/":
                target = root / "index.html"
            if not target.is_relative_to(root) or not target.is_file():
                return self.respond(404, {"error": "请先运行 npm run build"})
            self.send_response(200)
            self.send_header("Content-Type", mimetypes.guess_type(target)[0] or "application/octet-stream")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy",
                             "default-src 'self'; style-src 'self'; script-src 'self'; "
                             "connect-src 'self'; img-src 'self'; frame-ancestors 'none'")
            self.end_headers()
            self.wfile.write(target.read_bytes())

        def do_POST(self):
            if (not self.host_ok() or self.headers.get("Origin") != origin
                    or self.headers.get("X-Session-Token") != token):
                return self.respond(403, {"error": "请求来源或会话无效"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 256_000:
                    raise ValueError("请求内容大小无效")
                payload = json.loads(self.rfile.read(length))
                if not isinstance(payload, dict):
                    raise ValueError("请求格式无效")
                path = urlsplit(self.path).path
                if path == "/api/load":
                    result = service.load(payload.get("doc", ""))
                elif path == "/api/prepare":
                    result = service.prepare(payload)
                elif path == "/api/authoring":
                    result = service.authoring(payload)
                elif path == "/api/commit":
                    result = service.commit(payload.get("token", ""))
                else:
                    return self.respond(404, {"error": "接口不存在"})
                self.respond(200, result)
            except Exception as exc:
                self.respond(400, {"error": str(exc)})

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"角色创建工具：{origin}", flush=True)
    if args.open:
        webbrowser.open(origin)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
