// ── State ──
let currentMode = 'ai';
let conversationHistory = [];
let isProcessing = false;

// ── DOM ──
const chatArea = document.getElementById('chatArea');
const messagesEl = document.getElementById('messages');
const welcomeEl = document.getElementById('welcome');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
    checkStatus();

    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.classList.contains('unavailable')) return;
            setMode(btn.dataset.mode);
        });
    });

    chatForm.addEventListener('submit', e => {
        e.preventDefault();
        const query = chatInput.value.trim();
        if (query && !isProcessing) sendMessage(query);
    });

    chatInput.focus();
});

async function checkStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        const aiBtn = document.querySelector('[data-mode="ai"]');
        if (!data.ai_available) {
            aiBtn.classList.add('unavailable');
            aiBtn.title = '需要設定 DEEPSEEK_API_KEY';
        }
    } catch (e) {
        console.error('Status check failed:', e);
    }
}

function setMode(mode) {
    currentMode = mode;
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
}

// ── Public: called from suggestion buttons ──
function askQuestion(question) {
    chatInput.value = question;
    sendMessage(question);
}

// ── Send Message ──
async function sendMessage(query) {
    if (isProcessing) return;
    isProcessing = true;
    sendBtn.disabled = true;

    welcomeEl.style.display = 'none';
    addMessage(query, 'user');
    chatInput.value = '';

    const typingEl = addTypingIndicator();

    try {
        if (currentMode === 'ai') {
            await handleAIResponse(query, typingEl);
        } else {
            await handleSearchResponse(query, typingEl);
        }
    } catch (error) {
        removeElement(typingEl);
        addMessage('抱歉，發生了錯誤：' + error.message, 'bot');
    }

    isProcessing = false;
    sendBtn.disabled = false;
    chatInput.focus();
}

// ── Search Mode ──
async function handleSearchResponse(query, typingEl) {
    const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: query, mode: 'search' }),
    });

    const data = await res.json();
    removeElement(typingEl);

    if (data.results && data.results.length > 0) {
        const container = document.createElement('div');
        container.className = 'message bot';

        const label = document.createElement('div');
        label.className = 'message-bubble';
        label.innerHTML = `找到 <strong>${data.results.length}</strong> 筆相關結果：`;
        container.appendChild(label);

        data.results.forEach((result, i) => {
            const card = result.doc_type === 'article'
                ? createArticleCard(result, i === 0 && data.results.length === 1)
                : createStudyCard(result);
            container.appendChild(card);
        });

        messagesEl.appendChild(container);
    } else {
        addMessage('找不到相關結果，請嘗試其他關鍵字。', 'bot');
    }

    scrollToBottom();
}

// ── AI Mode (SSE) ──
async function handleAIResponse(query, typingEl) {
    const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message: query,
            mode: 'ai',
            history: conversationHistory,
        }),
    });

    removeElement(typingEl);

    if (res.headers.get('content-type')?.includes('text/event-stream')) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let aiText = '';

        const msgEl = addMessage('', 'bot');
        const bubble = msgEl.querySelector('.message-bubble');

        let buffer = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6).trim();
                if (data === '[DONE]') continue;
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.text) {
                        aiText += parsed.text;
                        bubble.innerHTML = marked.parse(aiText);
                        scrollToBottom();
                    } else if (parsed.error) {
                        bubble.innerHTML = `<p style="color:#c53030">${escapeHtml(parsed.error)}</p>`;
                    }
                } catch (_) {}
            }
        }

        conversationHistory.push({ role: 'user', content: query });
        conversationHistory.push({ role: 'assistant', content: aiText });
        if (conversationHistory.length > 10) {
            conversationHistory = conversationHistory.slice(-10);
        }
    } else {
        // Fallback: JSON (search mode when AI unavailable)
        const data = await res.json();
        if (data.results && data.results.length > 0) {
            const container = document.createElement('div');
            container.className = 'message bot';

            const note = document.createElement('div');
            note.className = 'message-bubble';
            note.innerHTML = '<em>AI 模式不可用，以下為搜尋結果：</em>';
            container.appendChild(note);

            data.results.forEach(r => {
                if (r.doc_type === 'article') {
                    container.appendChild(createArticleCard(r, false));
                }
            });
            messagesEl.appendChild(container);
        } else {
            addMessage('找不到相關結果。', 'bot');
        }
    }

    scrollToBottom();
}

// ── DOM Helpers ──
function addMessage(text, sender) {
    const msg = document.createElement('div');
    msg.className = `message ${sender}`;

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    if (sender === 'user') {
        bubble.textContent = text;
    } else {
        bubble.innerHTML = text ? marked.parse(text) : '';
    }

    msg.appendChild(bubble);
    messagesEl.appendChild(msg);
    scrollToBottom();
    return msg;
}

function createArticleCard(result, autoExpand) {
    const isDeleted = result.status === 'deleted';
    const card = document.createElement('div');
    card.className = `article-card${isDeleted ? ' article-card-deleted' : ''}${autoExpand ? ' expanded' : ''}`;

    // Header
    const header = document.createElement('div');
    header.className = 'article-card-header';
    header.onclick = () => card.classList.toggle('expanded');

    const left = document.createElement('div');
    const display = result.article_display || ('第 ' + result.article_number + ' 條');
    const meta = [result.chapter, result.section].filter(Boolean).join(' → ');
    left.innerHTML = `<span class="article-card-number">${escapeHtml(display)}</span>` +
        (meta ? `<span class="article-card-meta">${escapeHtml(meta)}</span>` : '');

    const toggle = document.createElement('span');
    toggle.className = 'article-card-toggle';
    toggle.textContent = '\u25BC';

    header.appendChild(left);
    header.appendChild(toggle);
    card.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'article-card-body';

    if (isDeleted) {
        body.innerHTML = '<p style="color:#c53030;margin-top:8px">本條已刪除。</p>';
    } else {
        let html = '';

        if (result.legal_text) {
            html += `<div class="section-label">條文原文</div>
                     <div class="legal-text">${escapeHtml(result.legal_text)}</div>`;
        }
        if (result.explanation) {
            html += `<div class="section-label">白話解說</div>
                     <div class="explanation">${marked.parse(result.explanation)}</div>`;
        }
        if (result.tags) {
            const tags = result.tags.split(',').map(t => t.trim()).filter(Boolean);
            if (tags.length) {
                html += `<div class="section-label">標籤</div><div>` +
                    tags.map(t => `<span class="article-tag">${escapeHtml(t)}</span>`).join('') +
                    `</div>`;
            }
        }
        if (result.related && result.related.length > 0) {
            html += `<div class="section-label">相關條文</div><div>`;
            result.related.forEach(r => {
                html += `<button class="related-link" onclick="askQuestion('第 ${escapeHtml(r.number)} 條')">第 ${escapeHtml(r.number)} 條</button>`;
            });
            html += `</div>`;
        }

        body.innerHTML = html;
    }

    card.appendChild(body);
    return card;
}

function createStudyCard(result) {
    const card = document.createElement('div');
    card.className = 'article-card';

    const header = document.createElement('div');
    header.className = 'article-card-header';
    header.onclick = () => card.classList.toggle('expanded');

    const left = document.createElement('div');
    left.innerHTML = `<span class="article-card-number">${escapeHtml(result.title || '學習資源')}</span>`;

    const toggle = document.createElement('span');
    toggle.className = 'article-card-toggle';
    toggle.textContent = '\u25BC';

    header.appendChild(left);
    header.appendChild(toggle);
    card.appendChild(header);

    const body = document.createElement('div');
    body.className = 'article-card-body';
    const content = result.raw_content || '';
    body.innerHTML = `<div class="explanation">${marked.parse(content.substring(0, 2000))}</div>`;
    card.appendChild(body);

    return card;
}

function addTypingIndicator() {
    const msg = document.createElement('div');
    msg.className = 'message bot';
    msg.innerHTML = `<div class="typing-indicator"><span></span><span></span><span></span></div>`;
    messagesEl.appendChild(msg);
    scrollToBottom();
    return msg;
}

function removeElement(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
}

function scrollToBottom() {
    chatArea.scrollTop = chatArea.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
