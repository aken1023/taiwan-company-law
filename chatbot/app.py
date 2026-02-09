"""公司法知識庫聊天機器人 - Flask 主程式"""

import os
from pathlib import Path
from flask import Flask, render_template, request, jsonify, Response
from dotenv import load_dotenv

load_dotenv()

from indexer import build_index, get_index
from searcher import search, get_article
from ai_handler import generate_ai_response

app = Flask(__name__)

KB_ROOT = Path(__file__).resolve().parent.parent
INDEX_DIR = Path(__file__).resolve().parent / "index_data"


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/api/status")
def status():
    ix = get_index(INDEX_DIR)
    ai_available = bool(os.environ.get("DEEPSEEK_API_KEY"))
    doc_count = ix.doc_count() if ix else 0
    return jsonify({
        "indexed_docs": doc_count,
        "ai_available": ai_available,
    })


@app.route("/api/search")
def api_search():
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"results": []})
    ix = get_index(INDEX_DIR)
    results = search(ix, q)
    return jsonify({"query": q, "results": results})


@app.route("/api/article/<path:number>")
def api_article(number):
    ix = get_index(INDEX_DIR)
    result = get_article(ix, number)
    if result:
        return jsonify(result)
    return jsonify({"error": "找不到該條文"}), 404


@app.route("/api/chat", methods=["POST"])
def api_chat():
    data = request.get_json()
    message = data.get("message", "").strip()
    mode = data.get("mode", "search")
    history = data.get("history", [])

    if not message:
        return jsonify({"error": "請輸入問題"}), 400

    ix = get_index(INDEX_DIR)

    if mode == "ai" and os.environ.get("DEEPSEEK_API_KEY"):
        results = search(ix, message, limit=8)

        def generate():
            for chunk in generate_ai_response(message, results, history):
                yield f"data: {chunk}\n\n"
            yield "data: [DONE]\n\n"

        return Response(
            generate(),
            mimetype="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    else:
        results = search(ix, message)
        return jsonify({"mode": "search", "query": message, "results": results})


if __name__ == "__main__":
    print("=" * 50)
    print("  公司法知識庫聊天機器人")
    print("=" * 50)

    ix = get_index(INDEX_DIR)
    if ix is None or ix.doc_count() == 0:
        print("\n正在建立搜尋索引...")
        build_index(KB_ROOT, INDEX_DIR)
        ix = get_index(INDEX_DIR)
        print(f"索引建立完成，共 {ix.doc_count()} 個文件")
    else:
        print(f"已載入索引，共 {ix.doc_count()} 個文件")

    if os.environ.get("DEEPSEEK_API_KEY"):
        print("AI 模式已啟用 (DeepSeek)")
    else:
        print("僅搜尋模式（設定 DEEPSEEK_API_KEY 啟用 AI）")

    print(f"\n開啟 http://localhost:5000\n")
    app.run(host="0.0.0.0", debug=True, port=5003)
