import http.server
import socketserver
import json
import os
import io
import time
import base64
import sys
sys.stdout.reconfigure(encoding='utf-8')
from PIL import Image

PORT = 8080
DIRECTORY = os.path.dirname(os.path.abspath(__file__))
EXPORTS_DIR = os.path.join(DIRECTORY, 'exports')
os.makedirs(EXPORTS_DIR, exist_ok=True)

class BannerServerHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_POST(self):
        if self.path == '/api/export-banner':
            try:
                content_len = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_len)
                payload = json.loads(body.decode('utf-8'))

                cols = payload.get('cols', 15)
                rows = payload.get('rows', 6)
                slots = payload.get('slots', [])

                card_w = 230
                card_h = 361
                gap = 3

                total_w = cols * card_w + (cols + 1) * gap
                total_h = rows * card_h + (rows + 1) * gap

                # Background: Lien Quan deep dark navy
                banner_img = Image.new('RGBA', (total_w, total_h), (6, 14, 38, 255))

                for slot in slots:
                    r = slot.get('row', 0)
                    c = slot.get('col', 0)
                    colspan = slot.get('colspan', 1)
                    rowspan = slot.get('rowspan', 1)
                    stype = slot.get('type')
                    data_url = slot.get('data')
                    rel_path = slot.get('rel_path')

                    slot_w = colspan * card_w + (colspan - 1) * gap
                    slot_h = rowspan * card_h + (rowspan - 1) * gap
                    pos_x = gap + c * (card_w + gap)
                    pos_y = gap + r * (card_h + gap)

                    img_to_paste = None

                    if stype == 'crop' and data_url:
                        # Base64 data URL
                        try:
                            if ',' in data_url:
                                b64_str = data_url.split(',', 1)[1]
                            else:
                                b64_str = data_url
                            raw_bytes = base64.b64decode(b64_str)
                            loaded = Image.open(io.BytesIO(raw_bytes)).convert('RGBA')
                            img_to_paste = loaded.resize((slot_w, slot_h), Image.Resampling.LANCZOS)
                        except Exception as e:
                            print(f"Error loading crop image: {e}")

                    elif stype == 'skin' and rel_path:
                        local_path = os.path.join(DIRECTORY, 'skins', rel_path.replace('/', os.sep))
                        if os.path.exists(local_path):
                            try:
                                loaded = Image.open(local_path).convert('RGBA')
                                img_to_paste = loaded.resize((slot_w, slot_h), Image.Resampling.LANCZOS)
                            except Exception as e:
                                print(f"Error loading skin {rel_path}: {e}")

                    if img_to_paste:
                        banner_img.paste(img_to_paste, (pos_x, pos_y), img_to_paste)

                filename = f"LienQuan_Banner_{int(time.time())}.png"
                out_path = os.path.join(EXPORTS_DIR, filename)
                banner_img.save(out_path, format='PNG', optimize=True)

                resp_data = {
                    'status': 'ok',
                    'filename': filename,
                    'download_url': f'/exports/{filename}',
                    'width': total_w,
                    'height': total_h
                }

                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps(resp_data).encode('utf-8'))
                return

            except Exception as ex:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'error', 'error': str(ex)}).encode('utf-8'))
                return

        super().do_POST()

if __name__ == '__main__':
    # Allow port reuse immediately
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), BannerServerHandler) as httpd:
        print(f"============================================================")
        print(f"🔥 LIEN QUAN BANNER SERVER ĐANG CHẠY OFFLINE TẠI:")
        print(f"👉 http://localhost:{PORT}")
        print(f"============================================================")
        httpd.serve_forever()
