"""DeepSeek API RAG 管線：搜尋相關條文 -> 組合上下文 -> 生成回答"""

import os
import json
from openai import OpenAI


SYSTEM_PROMPT = """你是「公司法小助手」，一個專精台灣公司法的 AI 助理。

回答規則：
1. 根據提供的條文資料，用淺顯易懂的繁體中文回答
2. 務必引用具體條號（如「依據第 X 條」），讓使用者可以查證
3. 先給出直接答案，再補充說明細節
4. 如果資料不足以回答，誠實說明並建議查閱哪些條文
5. 使用 Markdown 格式（標題、粗體、列表等）

注意事項：
- 僅回答與台灣公司法相關的問題
- 不提供具體法律諮詢建議，建議諮詢專業律師
- 使用繁體中文回答
- 保持回答簡潔但完整"""


def get_client():
    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        return None
    return OpenAI(api_key=api_key, base_url="https://api.deepseek.com")


def build_context(results):
    """Build context string from search results for RAG."""
    if not results:
        return "（未找到相關條文）"

    parts = []
    total_chars = 0

    for r in results:
        if r.get("doc_type") == "article":
            part = f"### {r.get('article_display', '')}"
            if r.get("chapter"):
                part += f"\n章節：{r['chapter']}"
            if r.get("section"):
                part += f" → {r['section']}"
            if r.get("status") == "deleted":
                part += "\n（本條已刪除）"
            else:
                if r.get("legal_text"):
                    part += f"\n\n條文原文：\n{r['legal_text']}"
                if r.get("explanation"):
                    part += f"\n\n白話解說：\n{r['explanation']}"
                if r.get("cases"):
                    part += f"\n\n實務案例：\n{r['cases']}"
            parts.append(part)
            total_chars += len(part)
        else:
            raw = r.get("raw_content", "")[:1500]
            parts.append(f"### {r.get('title', '學習資源')}\n{raw}")
            total_chars += len(raw)

        if total_chars >= 8000:
            break

    return "\n\n---\n\n".join(parts)


def refine_question(query):
    """Refine user's question to be more precise and professional for legal search."""
    client = get_client()
    if not client:
        return None

    refine_prompt = """你是法律問題優化助手。請將使用者的問題改寫得更精確、專業，適合用於法律知識庫查詢。

優化原則：
1. 保持問題的核心意圖不變
2. 使用更精確的法律術語（如：董事 vs 公司負責人、股東會 vs 股東大會）
3. 補充可能的關鍵法律概念
4. 去除口語化、重複或不必要的描述
5. 如果問題太模糊，增加具體情境
6. 保持繁體中文

範例：
- 輸入：「公司老闆要負什麼責任？」
  輸出：「公司董事的法律責任與義務有哪些？」

- 輸入：「開公司要準備什麼」
  輸出：「公司設立的法定要件與登記程序」

- 輸入：「股東可以做什麼」
  輸出：「股東的權利與義務，包括表決權、盈餘分配權、股東會權限」

請直接輸出優化後的問題，不要有其他說明文字。"""

    try:
        response = client.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {"role": "system", "content": refine_prompt},
                {"role": "user", "content": query}
            ],
            max_tokens=200,
            temperature=0.5,
        )

        refined = response.choices[0].message.content.strip()
        # Remove quotes if AI wrapped the answer
        refined = refined.strip('"\'「」')
        return refined

    except Exception as e:
        print(f"Question refinement error: {e}")
        return None


def generate_ai_response(query, search_results, history=None):
    """Generate AI response using DeepSeek API with RAG. Yields JSON chunks."""
    client = get_client()
    if not client:
        yield json.dumps({"error": "AI 服務未設定"}, ensure_ascii=False)
        return

    context = build_context(search_results)

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]

    # Add conversation history (last 5 turns)
    if history:
        for msg in history[-10:]:
            messages.append({
                "role": msg.get("role", "user"),
                "content": msg.get("content", ""),
            })

    user_message = f"""以下是與問題相關的公司法條文資料：

{context}

---

使用者問題：{query}"""

    messages.append({"role": "user", "content": user_message})

    try:
        response = client.chat.completions.create(
            model="deepseek-chat",
            messages=messages,
            stream=True,
            max_tokens=2000,
            temperature=0.3,
        )

        for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content:
                text = chunk.choices[0].delta.content
                yield json.dumps({"text": text}, ensure_ascii=False)

    except Exception as e:
        yield json.dumps({"error": f"AI 回應錯誤：{str(e)}"}, ensure_ascii=False)


def generate_related_questions(query, ai_response):
    """Generate related questions based on the conversation."""
    client = get_client()
    if not client:
        return []

    prompt = """基於使用者的問題和 AI 的回答，生成 3-5 個相關的後續問題。

要求：
1. 問題應該是自然的後續提問，幫助使用者深入了解相關主題
2. 問題應該具體、明確，並且與台灣公司法相關
3. 每個問題獨立成行，不要編號
4. 問題應該多樣化，涵蓋不同角度（法律責任、實務操作、相關條文等）
5. 使用繁體中文

範例：
使用者問題：什麼是股份有限公司？
AI 回答：[關於股份有限公司的定義和特點...]

推薦問題：
股份有限公司的設立流程是什麼？
股份有限公司和有限公司有什麼差別？
股份有限公司的董事會如何組成？
股份有限公司的股東有哪些權利？"""

    try:
        response = client.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": f"使用者問題：{query}\n\nAI 回答：{ai_response[:500]}"}
            ],
            max_tokens=300,
            temperature=0.7,
        )

        questions_text = response.choices[0].message.content.strip()
        questions = [q.strip() for q in questions_text.split('\n') if q.strip()]
        # Remove any numbering or bullets
        questions = [q.lstrip('0123456789.-•● ') for q in questions]
        return questions[:5]

    except Exception as e:
        print(f"Related questions generation error: {e}")
        return []
