"""Markdown 知識庫解析器 + Whoosh 索引建立"""

import re
from pathlib import Path

import frontmatter
import jieba
from whoosh import index
from whoosh.fields import Schema, TEXT, ID, KEYWORD, STORED
from whoosh.analysis import Tokenizer, Token


class JiebaTokenizer(Tokenizer):
    """Whoosh tokenizer using jieba for Chinese text segmentation."""

    def __call__(self, value, positions=False, chars=False, keeporiginal=False,
                 removestops=True, start_pos=0, start_char=0, tokenize=True,
                 mode='', **kwargs):
        t = Token(positions, chars, removestops=removestops)
        pos = start_pos
        char_offset = 0
        for word in jieba.cut(value):
            word = word.strip()
            if not word:
                continue
            t.original = t.text = word
            t.boost = 1.0
            if positions:
                t.pos = pos
            if chars:
                idx = value.find(word, char_offset)
                if idx >= 0:
                    t.startchar = idx
                    t.endchar = idx + len(word)
                    char_offset = t.endchar
            pos += 1
            yield t


def ChineseAnalyzer():
    return JiebaTokenizer()


def get_schema():
    analyzer = ChineseAnalyzer()
    return Schema(
        path=ID(stored=True, unique=True),
        article_number=ID(stored=True),
        article_display=STORED(),
        chapter=STORED(),
        section=STORED(),
        status=ID(stored=True),
        tags=KEYWORD(stored=True, commas=True, scorable=True),
        legal_text=TEXT(stored=True, analyzer=analyzer, field_boost=3.0),
        explanation=TEXT(stored=True, analyzer=analyzer, field_boost=2.5),
        summary=TEXT(stored=True, analyzer=analyzer, field_boost=1.5),
        cases=TEXT(stored=True, analyzer=analyzer),
        related=STORED(),
        full_text=TEXT(analyzer=analyzer),
        doc_type=ID(stored=True),
        title=STORED(),
        raw_content=STORED(),
    )


def load_glossary_terms(kb_root):
    """Load legal terms from glossary and add to jieba dictionary."""
    glossary_path = kb_root / "study" / "glossary.md"
    if not glossary_path.exists():
        return

    content = glossary_path.read_text(encoding="utf-8")
    terms = re.findall(r'\*\*(.+?)\*\*', content)
    for term in terms:
        jieba.add_word(term, freq=1000)


def parse_sections(content):
    """Split markdown content by ## headers into a dict."""
    sections = {}
    current_key = None
    current_lines = []

    for line in content.split('\n'):
        if line.startswith('## '):
            if current_key:
                sections[current_key] = '\n'.join(current_lines).strip()
            current_key = line[3:].strip()
            current_lines = []
        else:
            current_lines.append(line)

    if current_key:
        sections[current_key] = '\n'.join(current_lines).strip()

    return sections


def parse_related_articles(text):
    """Extract related article references from markdown table."""
    related = []
    for match in re.finditer(r'\[第\s*(\S+?)\s*條\]\((.+?)\)', text):
        related.append({"number": match.group(1), "path": match.group(2)})
    return related


def index_article(writer, file_path, kb_root):
    """Index a single article markdown file."""
    try:
        post = frontmatter.load(str(file_path), encoding="utf-8")
    except Exception:
        return

    meta = post.metadata
    content = post.content
    sections = parse_sections(content)

    article_num = str(meta.get("article", ""))
    article_display = meta.get("article_display", f"第 {article_num} 條")
    chapter = meta.get("chapter", "")
    section = meta.get("section", "")
    status = meta.get("status", "active")
    tags = ",".join(meta.get("tags", []))

    legal_text = sections.get("條文原文", "")
    legal_text = re.sub(r'^>\s*', '', legal_text, flags=re.MULTILINE).strip()

    explanation = sections.get("白話解說", "")
    summary_text = sections.get("重點摘要", "")
    cases = sections.get("實務案例", "")
    related_text = sections.get("相關條文", "")
    related = parse_related_articles(related_text) if related_text else []

    rel_path = str(file_path.relative_to(kb_root))
    full_text = f"{article_display} {legal_text} {explanation} {summary_text} {cases} {tags}"

    writer.add_document(
        path=rel_path,
        article_number=article_num,
        article_display=article_display,
        chapter=chapter,
        section=section,
        status=status,
        tags=tags,
        legal_text=legal_text,
        explanation=explanation,
        summary=summary_text,
        cases=cases,
        related=related,
        full_text=full_text,
        doc_type="article",
        title=article_display,
        raw_content=content,
    )


def index_study_file(writer, file_path, kb_root):
    """Index a study resource file."""
    try:
        content = file_path.read_text(encoding="utf-8")
    except Exception:
        return

    rel_path = str(file_path.relative_to(kb_root))
    title = ""
    for line in content.split('\n'):
        if line.startswith('# '):
            title = line[2:].strip()
            break

    doc_type = "study"
    if "glossary" in file_path.name:
        doc_type = "glossary"
    elif "faq" in file_path.name:
        doc_type = "faq"
    elif "summary" in file_path.name:
        doc_type = "summary"
    elif "topic-guides" in str(file_path):
        doc_type = "guide"

    writer.add_document(
        path=rel_path,
        article_number="",
        article_display="",
        chapter="",
        section="",
        status="active",
        tags="",
        legal_text="",
        explanation="",
        summary="",
        cases="",
        related=[],
        full_text=content,
        doc_type=doc_type,
        title=title,
        raw_content=content,
    )


def build_index(kb_root, index_dir):
    """Build the Whoosh search index from the knowledge base."""
    kb_root = Path(kb_root)
    index_dir = Path(index_dir)

    # Load glossary terms into jieba
    load_glossary_terms(kb_root)

    # Add common legal terms
    for term in ["股份有限公司", "有限公司", "無限公司", "兩合公司", "閉鎖性",
                 "董事會", "監察人", "股東會", "公司債", "發行新股", "清算",
                 "章程", "表決權", "特別股", "關係企業", "公司負責人",
                 "資本額", "股東名簿", "公開發行", "累積投票制"]:
        jieba.add_word(term, freq=1000)

    # Create index directory
    index_dir.mkdir(parents=True, exist_ok=True)

    schema = get_schema()
    ix = index.create_in(str(index_dir), schema)
    writer = ix.writer()

    # Index all article files
    article_count = 0
    for md_file in sorted(kb_root.rglob("art-*.md")):
        if "chatbot" in str(md_file):
            continue
        index_article(writer, md_file, kb_root)
        article_count += 1

    # Index study files
    study_count = 0
    study_dir = kb_root / "study"
    if study_dir.exists():
        for md_file in study_dir.rglob("*.md"):
            if md_file.name == "README.md":
                continue
            index_study_file(writer, md_file, kb_root)
            study_count += 1

    writer.commit()
    print(f"  條文檔案: {article_count}")
    print(f"  學習資源: {study_count}")
    return ix


def get_index(index_dir):
    """Open existing Whoosh index, or return None."""
    index_dir = Path(index_dir)
    if index_dir.exists() and index.exists_in(str(index_dir)):
        return index.open_dir(str(index_dir))
    return None
