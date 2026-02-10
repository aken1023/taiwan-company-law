"""公司法知識庫聊天機器人 - Flask 主程式"""

import os
import json
import subprocess
from pathlib import Path
from flask import Flask, render_template, request, jsonify, Response
from dotenv import load_dotenv

load_dotenv()

from indexer import build_index, get_index
from searcher import search, get_article
from ai_handler import generate_ai_response, refine_question, generate_related_questions

# Taiwan Judicial Decisions Skill Path
SKILL_PATH = Path.home() / ".claude" / "skills" / "taiwan-judicial-decisions"
SCRIPTS_PATH = SKILL_PATH / "scripts"

app = Flask(__name__)

KB_ROOT = Path(__file__).resolve().parent.parent
INDEX_DIR = Path(__file__).resolve().parent / "index_data"


@app.route("/")
def home():
    """New UI design inspired by TaiLexi (Default)"""
    return render_template("index_new.html")


@app.route("/classic")
def home_classic():
    """Classic UI (Simple and focused)"""
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


@app.route("/api/refine", methods=["POST"])
def api_refine():
    """Refine user's question using AI."""
    data = request.get_json()
    query = data.get("query", "").strip()

    if not query:
        return jsonify({"error": "請輸入問題"}), 400

    if not os.environ.get("DEEPSEEK_API_KEY"):
        return jsonify({"error": "AI 服務未設定"}), 503

    refined = refine_question(query)

    if refined and refined != query:
        return jsonify({"original": query, "refined": refined, "success": True})
    else:
        return jsonify({"original": query, "refined": query, "success": False})


@app.route("/api/related-questions", methods=["POST"])
def api_related_questions():
    """Generate related questions based on conversation."""
    data = request.get_json()
    query = data.get("query", "").strip()
    ai_response = data.get("response", "").strip()

    if not query or not ai_response:
        return jsonify({"error": "缺少必要參數"}), 400

    if not os.environ.get("DEEPSEEK_API_KEY"):
        return jsonify({"questions": []}), 200

    questions = generate_related_questions(query, ai_response)
    return jsonify({"questions": questions})


@app.route("/api/judgments/search", methods=["POST"])
def api_judgments_search():
    """Search judicial decisions."""
    data = request.get_json()
    keywords = data.get("keywords", "").strip()
    article = data.get("article", "").strip()
    court = data.get("court", "all")
    case_type = data.get("type", "all")
    limit = data.get("limit", 10)

    if not keywords and not article:
        return jsonify({"error": "請輸入關鍵字或法條"}), 400

    try:
        # Build command
        cmd = ["python", str(SCRIPTS_PATH / "query_judgment.py")]

        if keywords:
            cmd.extend(["--keywords", keywords])
        if article:
            cmd.extend(["--article", article])
        if court != "all":
            cmd.extend(["--court", court])
        if case_type != "all":
            cmd.extend(["--type", case_type])

        cmd.extend(["--limit", str(limit)])
        cmd.extend(["--output", "json"])
        cmd.extend(["--no-verify-ssl"])  # Add SSL bypass

        # Set UTF-8 encoding for subprocess
        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"

        # Execute script with proper encoding
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding='utf-8',
            timeout=30,
            env=env
        )

        if result.returncode == 0:
            output = result.stdout

            # Find JSON array in output
            json_start = output.find('[')
            if json_start >= 0:
                json_str = output[json_start:]
                try:
                    judgments = json.loads(json_str)
                    return jsonify({"judgments": judgments, "count": len(judgments)})
                except json.JSONDecodeError as e:
                    return jsonify({"error": f"JSON 解析錯誤：{str(e)}", "raw": json_str[:200]}), 500
            else:
                return jsonify({"judgments": [], "count": 0, "debug": output[:500]})
        else:
            error_msg = result.stderr if result.stderr else "查詢失敗"
            return jsonify({"error": error_msg}), 500

    except subprocess.TimeoutExpired:
        return jsonify({"error": "查詢逾時，請稍後再試"}), 408
    except Exception as e:
        return jsonify({"error": f"查詢錯誤：{str(e)}"}), 500


@app.route("/api/judgments/parse", methods=["POST"])
def api_judgments_parse():
    """Parse judgment content."""
    data = request.get_json()
    judgment_text = data.get("text", "").strip()

    if not judgment_text:
        return jsonify({"error": "請提供判決書內容"}), 400

    try:
        # Create temp file for judgment text
        temp_file = Path(__file__).parent / "temp_judgment.txt"
        temp_file.write_text(judgment_text, encoding='utf-8')

        # Execute parse script
        cmd = [
            "python",
            str(SCRIPTS_PATH / "parse_judgment.py"),
            str(temp_file),
            "-o", "json",
            "-f", "json"
        ]

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=15,
            encoding='utf-8'
        )

        # Clean up temp file
        temp_file.unlink(missing_ok=True)

        if result.returncode == 0:
            parsed = json.loads(result.stdout) if result.stdout else {}
            return jsonify(parsed)
        else:
            return jsonify({"error": "解析失敗"}), 500

    except Exception as e:
        return jsonify({"error": f"解析錯誤：{str(e)}"}), 500


@app.route("/api/judgments/by-article", methods=["POST"])
def api_judgments_by_article():
    """Search judgments by article number."""
    data = request.get_json()
    law = data.get("law", "公司法")
    article = data.get("article", "").strip()

    if not article:
        return jsonify({"error": "請提供條號"}), 400

    try:
        cmd = [
            "python",
            str(SCRIPTS_PATH / "search_by_article.py"),
            "--law", law,
            "--article", article,
            "--kb-path", str(KB_ROOT),
            "--output", "json"
        ]

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
            encoding='utf-8'
        )

        if result.returncode == 0:
            data = json.loads(result.stdout) if result.stdout else {}
            return jsonify(data)
        else:
            return jsonify({"error": "查詢失敗"}), 500

    except Exception as e:
        return jsonify({"error": f"查詢錯誤：{str(e)}"}), 500


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
