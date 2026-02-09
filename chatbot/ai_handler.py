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
