"""搜尋邏輯：條號偵測、全文搜尋、排序"""

import re
from whoosh.qparser import MultifieldParser, OrGroup
from whoosh.query import Term
from whoosh import scoring


# Regex to detect article number queries
ARTICLE_NUM_RE = re.compile(r'第?\s*(\d+(?:-\d+)?)\s*條?')


def detect_article_number(query):
    """Try to extract an article number from the query."""
    m = ARTICLE_NUM_RE.search(query)
    if m:
        return m.group(1)
    m = re.match(r'^(\d+(?:-\d+)?)$', query.strip())
    if m:
        return m.group(1)
    return None


def search(ix, query, limit=10):
    """Search the index and return results."""
    if ix is None:
        return []

    results_list = []

    with ix.searcher(weighting=scoring.BM25F()) as searcher:
        # Check if query is an article number lookup
        art_num = detect_article_number(query)
        if art_num:
            results = searcher.search(Term("article_number", art_num), limit=1)
            if results:
                for hit in results:
                    results_list.append(format_hit(hit))
                return results_list

        # Full-text search
        parser = MultifieldParser(
            ["legal_text", "explanation", "summary", "cases", "tags", "full_text"],
            schema=ix.schema,
            group=OrGroup,
        )
        qobj = parser.parse(query)
        results = searcher.search(qobj, limit=limit)

        for hit in results:
            results_list.append(format_hit(hit))

    return results_list


def format_hit(hit):
    """Format a search hit into a dict for the API response."""
    doc_type = hit.get("doc_type", "article")

    result = {
        "doc_type": doc_type,
        "path": hit.get("path", ""),
        "title": hit.get("title", ""),
        "score": round(hit.score, 2) if hasattr(hit, 'score') else 0,
    }

    if doc_type == "article":
        result.update({
            "article_number": hit.get("article_number", ""),
            "article_display": hit.get("article_display", ""),
            "chapter": hit.get("chapter", ""),
            "section": hit.get("section", ""),
            "status": hit.get("status", ""),
            "tags": hit.get("tags", ""),
            "legal_text": hit.get("legal_text", ""),
            "explanation": hit.get("explanation", ""),
            "summary": hit.get("summary", ""),
            "cases": hit.get("cases", ""),
            "related": hit.get("related", []),
        })
    else:
        result.update({
            "raw_content": hit.get("raw_content", "")[:2000],
        })

    return result


def get_article(ix, number):
    """Get a specific article by its number."""
    if ix is None:
        return None

    with ix.searcher() as searcher:
        results = searcher.search(Term("article_number", str(number)), limit=1)
        if results:
            return format_hit(results[0])
    return None
