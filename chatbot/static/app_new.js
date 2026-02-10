// ========================================
// 台灣法律知識系統 - 新版 JavaScript
// 參考 TaiLexi 專業功能
// ========================================

// ── State ──
let currentMode = 'ai';
let conversationHistory = [];
let isProcessing = false;
let searchHistory = [];
let bookmarks = [];
let customTags = [];
let searchFilters = {
    chapters: [],
    scope: 'all',
    status: 'active'
};

// ── DOM Elements ──
const chatArea = document.getElementById('chatArea');
const messagesEl = document.getElementById('messages');
const welcomeEl = document.getElementById('welcome');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const clearBtn = document.getElementById('clearBtn');
const historyBtn = document.getElementById('historyBtn');
const bookmarksBtn = document.getElementById('bookmarksBtn');
const exportBtn = document.getElementById('exportBtn');
const statsBtn = document.getElementById('statsBtn');
const themeToggle = document.getElementById('themeToggle');
const scrollToTopBtn = document.getElementById('scrollToTop');
const scrollProgress = document.getElementById('scrollProgress');

// ── Initialization ──
document.addEventListener('DOMContentLoaded', () => {
    checkStatus();
    loadStoredData();
    initializeEventListeners();
    autoResizeTextarea();
    chatInput.focus();
});

function initializeEventListeners() {
    // Mode toggle
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.classList.contains('unavailable')) return;
            setMode(btn.dataset.mode);
        });
    });

    // Form submission
    chatForm.addEventListener('submit', e => {
        e.preventDefault();
        const query = chatInput.value.trim();
        if (query && !isProcessing) sendMessage(query);
    });

    // Clear conversation
    clearBtn?.addEventListener('click', () => {
        if (confirm('確定要清除所有對話記錄嗎？')) {
            clearConversation();
        }
    });

    // History button
    historyBtn?.addEventListener('click', () => {
        showHistory();
    });

    // Bookmarks button
    bookmarksBtn?.addEventListener('click', () => {
        showBookmarks();
    });

    // Export button
    exportBtn?.addEventListener('click', () => {
        exportConversation();
    });

    // Stats button
    statsBtn?.addEventListener('click', () => {
        showStatsDashboard();
    });

    // Theme toggle
    themeToggle?.addEventListener('click', () => {
        toggleTheme();
    });

    // Feature cards
    document.querySelectorAll('.feature-card').forEach(card => {
        card.addEventListener('click', () => {
            const feature = card.dataset.feature;
            handleFeatureClick(feature);
        });
    });

    // Auto-resize textarea
    chatInput.addEventListener('input', autoResizeTextarea);

    // Filter chips
    initializeFilters();

    // Scroll to top button
    scrollToTopBtn?.addEventListener('click', () => {
        chatArea.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // Track scroll for scroll-to-top button and progress bar
    chatArea?.addEventListener('scroll', handleScroll);

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboardShortcuts);
}

// ── Scroll Handler ──
function handleScroll() {
    const scrollTop = chatArea.scrollTop;
    const scrollHeight = chatArea.scrollHeight - chatArea.clientHeight;
    const scrollPercent = (scrollTop / scrollHeight) * 100;

    // Update progress bar
    if (scrollProgress) {
        scrollProgress.style.width = `${scrollPercent}%`;
    }

    // Show/hide scroll to top button
    if (scrollToTopBtn) {
        if (scrollTop > 300) {
            scrollToTopBtn.classList.add('visible');
        } else {
            scrollToTopBtn.classList.remove('visible');
        }
    }
}

// ── Status Check ──
async function checkStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();

        // Update stats
        const statDocs = document.getElementById('statDocs');
        if (statDocs) statDocs.textContent = data.indexed_docs;

        // Check AI availability
        const aiBtn = document.querySelector('[data-mode="ai"]');
        if (!data.ai_available) {
            aiBtn.classList.add('unavailable');
            aiBtn.title = '需要設定 DEEPSEEK_API_KEY';
            setMode('search');
        }
    } catch (e) {
        console.error('Status check failed:', e);
    }
}

// ── Mode Management ──
function setMode(mode) {
    currentMode = mode;
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    // Update placeholder
    if (mode === 'ai') {
        chatInput.placeholder = '輸入您的法律問題，AI 將自動優化並提供專業解答...';
    } else {
        chatInput.placeholder = '輸入關鍵字或條號進行搜索，例如：第 23 條、董事責任...';
    }
}

// ── Public Functions (called from HTML) ──
window.askQuestion = function(question) {
    chatInput.value = question;
    sendMessage(question);
};

// ── Send Message ──
async function sendMessage(query) {
    if (isProcessing) return;
    isProcessing = true;
    sendBtn.disabled = true;

    // Hide welcome screen
    welcomeEl.style.display = 'none';

    // Show original user question
    addMessage(query, 'user');
    chatInput.value = '';
    autoResizeTextarea();

    // Add to search history
    addToHistory(query);

    // Track query
    trackQuery(query, currentMode);

    // Try to refine question in AI mode
    let refinedQuery = query;
    let showRefinement = false;

    if (currentMode === 'ai') {
        const refineResult = await refineQuestion(query);
        if (refineResult && refineResult.success && refineResult.refined !== query) {
            refinedQuery = refineResult.refined;
            showRefinement = true;
            // Show refined question
            addRefinedMessage(query, refinedQuery);
        }
    }

    const typingEl = addTypingIndicator();

    try {
        if (currentMode === 'ai') {
            await handleAIResponse(refinedQuery, typingEl);
        } else {
            await handleSearchResponse(refinedQuery, typingEl);
        }
    } catch (error) {
        removeElement(typingEl);
        addMessage('抱歉，發生了錯誤：' + error.message, 'bot');
    }

    isProcessing = false;
    sendBtn.disabled = false;
    chatInput.focus();
}

// ── Refine Question ──
async function refineQuestion(query) {
    try {
        const res = await fetch('/api/refine', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
        });

        if (!res.ok) return null;
        return await res.json();
    } catch (error) {
        console.error('Question refinement failed:', error);
        return null;
    }
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
                        bubble.innerHTML = `<p style="color:#f5576c">${escapeHtml(parsed.error)}</p>`;
                    }
                } catch (_) {}
            }
        }

        conversationHistory.push({ role: 'user', content: query });
        conversationHistory.push({ role: 'assistant', content: aiText });
        if (conversationHistory.length > 10) {
            conversationHistory = conversationHistory.slice(-10);
        }

        // Generate related questions
        generateRelatedQuestions(query, aiText, msgEl);
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

    // Add action buttons for bot messages
    if (sender === 'bot' && text) {
        const actions = createMessageActions(text, msg);
        msg.appendChild(actions);
    }

    messagesEl.appendChild(msg);
    scrollToBottom();
    return msg;
}

function createMessageActions(content, messageEl) {
    const actions = document.createElement('div');
    actions.className = 'message-actions';

    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'action-icon-btn';
    copyBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
        <span>複製</span>
    `;
    copyBtn.onclick = () => copyToClipboard(content, copyBtn);
    actions.appendChild(copyBtn);

    // Screenshot button
    const screenshotBtn = document.createElement('button');
    screenshotBtn.className = 'action-icon-btn';
    screenshotBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <path d="M21 15l-5-5L5 21"/>
        </svg>
        <span>截圖</span>
    `;
    screenshotBtn.onclick = () => captureMessageScreenshot(messageEl);
    actions.appendChild(screenshotBtn);

    // Share button
    const shareBtn = document.createElement('button');
    shareBtn.className = 'action-icon-btn';
    shareBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="18" cy="5" r="3"/>
            <circle cx="6" cy="12" r="3"/>
            <circle cx="18" cy="19" r="3"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
        </svg>
        <span>分享</span>
    `;
    shareBtn.onclick = () => shareContent(content);
    actions.appendChild(shareBtn);

    // Bookmark button
    const bookmarkBtn = document.createElement('button');
    bookmarkBtn.className = 'action-icon-btn';
    bookmarkBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
        </svg>
        <span>收藏</span>
    `;
    bookmarkBtn.onclick = () => toggleBookmark(content, messageEl, bookmarkBtn);
    actions.appendChild(bookmarkBtn);

    return actions;
}

function addRefinedMessage(original, refined) {
    const msg = document.createElement('div');
    msg.className = 'message system';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble refined-question';
    bubble.innerHTML = `
        <div class="refined-header">
            <span class="refined-icon">✨</span>
            <span class="refined-label">AI 優化問題</span>
        </div>
        <div class="refined-content">
            <div class="refined-text">${escapeHtml(refined)}</div>
        </div>
    `;

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
    toggle.textContent = '▼';

    header.appendChild(left);
    header.appendChild(toggle);
    card.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'article-card-body';

    if (isDeleted) {
        body.innerHTML = '<p style="color:#f5576c;margin-top:8px">本條已刪除。</p>';
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

        // Add action buttons for articles
        const cardActions = createArticleActions(result);
        body.appendChild(cardActions);
    }

    card.appendChild(body);
    return card;
}

function createArticleActions(article) {
    const actions = document.createElement('div');
    actions.className = 'article-card-actions';

    // Copy article button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'action-icon-btn';
    copyBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
        <span>複製條文</span>
    `;
    const articleText = `${article.article_display}\n\n${article.legal_text || ''}\n\n${article.explanation || ''}`;
    copyBtn.onclick = () => copyToClipboard(articleText, copyBtn);
    actions.appendChild(copyBtn);

    // Bookmark article button
    const bookmarkBtn = document.createElement('button');
    bookmarkBtn.className = 'action-icon-btn';
    const isBookmarked = bookmarks.some(b => b.articleNumber === article.article_number);
    if (isBookmarked) {
        bookmarkBtn.classList.add('bookmarked');
    }
    bookmarkBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="${isBookmarked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
        </svg>
        <span>${isBookmarked ? '已收藏' : '收藏'}</span>
    `;
    bookmarkBtn.onclick = () => toggleArticleBookmark(article, bookmarkBtn);
    actions.appendChild(bookmarkBtn);

    return actions;
}

function toggleArticleBookmark(article, button) {
    const timestamp = new Date().toISOString();
    const bookmark = {
        type: 'article',
        articleNumber: article.article_number,
        articleDisplay: article.article_display,
        content: article.legal_text || article.explanation || '',
        timestamp,
        id: Date.now().toString()
    };

    const isBookmarked = bookmarks.some(b => b.articleNumber === article.article_number);

    if (isBookmarked) {
        bookmarks = bookmarks.filter(b => b.articleNumber !== article.article_number);
        button.classList.remove('bookmarked');
        button.querySelector('svg').setAttribute('fill', 'none');
        button.querySelector('span').textContent = '收藏';
        showToast('已取消收藏此法條', 'success');
    } else {
        bookmarks.unshift(bookmark);
        button.classList.add('bookmarked');
        button.querySelector('svg').setAttribute('fill', 'currentColor');
        button.querySelector('span').textContent = '已收藏';
        showToast('已將法條加入收藏', 'success');
    }

    saveToStorage('bookmarks', bookmarks);
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
    toggle.textContent = '▼';

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

// ── Conversation Management ──
function clearConversation() {
    messagesEl.innerHTML = '';
    conversationHistory = [];
    welcomeEl.style.display = 'block';
    scrollToBottom();
}

// ── History Management ──
function addToHistory(query) {
    const timestamp = new Date().toISOString();
    searchHistory.unshift({ query, timestamp, mode: currentMode });

    // Keep only last 50 searches
    if (searchHistory.length > 50) {
        searchHistory = searchHistory.slice(0, 50);
    }

    saveToStorage('searchHistory', searchHistory);
}

function showHistory() {
    if (searchHistory.length === 0) {
        alert('尚無搜索歷史記錄');
        return;
    }

    const historyHtml = searchHistory.slice(0, 10).map(item => {
        const date = new Date(item.timestamp);
        const timeStr = date.toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        return `<button class="question-tag" onclick="askQuestion('${escapeHtml(item.query)}')">
            <span class="tag-icon">🕐</span>
            ${escapeHtml(item.query)}
            <span style="opacity:0.6;margin-left:8px;font-size:11px">${timeStr}</span>
        </button>`;
    }).join('');

    const container = document.createElement('div');
    container.className = 'message bot';
    container.innerHTML = `
        <div class="message-bubble">
            <strong>📜 最近搜索記錄</strong>
        </div>
        <div class="quick-questions" style="margin-top:12px;max-width:80%;">
            <div class="question-tags">${historyHtml}</div>
        </div>
    `;

    messagesEl.appendChild(container);
    welcomeEl.style.display = 'none';
    scrollToBottom();
}

function showBookmarks() {
    if (bookmarks.length === 0) {
        showToast('尚無收藏內容', 'error');
        return;
    }

    const bookmarksHTML = `
        <div class="message bot">
            <div class="message-bubble">
                <strong>⭐ 我的收藏 (${bookmarks.length})</strong>
            </div>
            <div class="quick-questions" style="margin-top:12px;max-width:85%;">
                <div style="display:flex;flex-direction:column;gap:12px;">
                    ${bookmarks.slice(0, 10).map((bm, i) => {
                        const preview = bm.content.substring(0, 100);
                        const date = new Date(bm.timestamp);
                        const dateStr = date.toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' });
                        return `
                            <div style="background:var(--bg-secondary);padding:12px;border-radius:8px;border:1px solid var(--border);">
                                <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px;">
                                    <strong style="color:var(--text-primary);font-size:13px;">${bm.articleDisplay || '收藏項目'}</strong>
                                    <span style="font-size:11px;color:var(--text-muted);">${dateStr}</span>
                                </div>
                                <div style="font-size:12px;color:var(--text-secondary);line-height:1.6;">${escapeHtml(preview)}${bm.content.length > 100 ? '...' : ''}</div>
                                <div style="margin-top:8px;display:flex;gap:8px;">
                                    <button class="action-icon-btn" onclick="removeBookmark(${i})">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <polyline points="3 6 5 6 21 6"/>
                                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                        </svg>
                                        <span>移除</span>
                                    </button>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        </div>
    `;

    messagesEl.innerHTML += bookmarksHTML;
    welcomeEl.style.display = 'none';
    scrollToBottom();
}

window.removeBookmark = function(index) {
    bookmarks.splice(index, 1);
    saveToStorage('bookmarks', bookmarks);
    showToast('已移除收藏', 'success');
    // Refresh the bookmarks display
    messagesEl.innerHTML = '';
    showBookmarks();
}

// ── Local Storage ──
function loadStoredData() {
    try {
        searchHistory = JSON.parse(localStorage.getItem('searchHistory') || '[]');
        bookmarks = JSON.parse(localStorage.getItem('bookmarks') || '[]');
        customTags = JSON.parse(localStorage.getItem('customTags') || '[]');

        // Load theme preference
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
        updateThemeIcon(savedTheme);

        // Track stats
        trackPageView();
    } catch (e) {
        console.error('Failed to load stored data:', e);
    }
}

function trackPageView() {
    const stats = JSON.parse(localStorage.getItem('usageStats') || '{}');
    const today = new Date().toISOString().split('T')[0];

    if (!stats.dailyViews) stats.dailyViews = {};
    if (!stats.dailyQueries) stats.dailyQueries = {};
    if (!stats.topArticles) stats.topArticles = {};
    if (!stats.modeUsage) stats.modeUsage = { ai: 0, search: 0 };

    stats.dailyViews[today] = (stats.dailyViews[today] || 0) + 1;
    stats.totalViews = (stats.totalViews || 0) + 1;

    localStorage.setItem('usageStats', JSON.stringify(stats));
}

function trackQuery(query, mode) {
    const stats = JSON.parse(localStorage.getItem('usageStats') || '{}');
    const today = new Date().toISOString().split('T')[0];

    if (!stats.dailyQueries) stats.dailyQueries = {};
    if (!stats.modeUsage) stats.modeUsage = { ai: 0, search: 0 };

    stats.dailyQueries[today] = (stats.dailyQueries[today] || 0) + 1;
    stats.modeUsage[mode] = (stats.modeUsage[mode] || 0) + 1;

    localStorage.setItem('usageStats', JSON.stringify(stats));
}

function saveToStorage(key, data) {
    try {
        localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
        console.error('Failed to save to storage:', e);
    }
}

// ── Auto-resize Textarea ──
function autoResizeTextarea() {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
}

// ── Feature Click Handler ──
function handleFeatureClick(feature) {
    switch (feature) {
        case 'qa':
            setMode('ai');
            chatInput.focus();
            break;
        case 'search':
            setMode('search');
            chatInput.focus();
            break;
        case 'judgments':
            openJudgmentModal();
            break;
        case 'compare':
            openCompareModal();
            break;
    }
}

// ── Judgment Search Functions ──
window.openJudgmentModal = function() {
    const modal = document.getElementById('judgmentModal');
    modal.classList.add('visible');
    document.getElementById('judgmentKeywords').focus();
};

window.closeJudgmentModal = function() {
    const modal = document.getElementById('judgmentModal');
    modal.classList.remove('visible');
};

window.searchJudgments = async function() {
    const keywords = document.getElementById('judgmentKeywords').value.trim();
    const article = document.getElementById('judgmentArticle').value.trim();
    const court = document.getElementById('judgmentCourt').value;
    const type = document.getElementById('judgmentType').value;

    if (!keywords && !article) {
        showToast('請輸入關鍵字或法條', 'error');
        return;
    }

    // Close modal
    closeJudgmentModal();

    // Hide welcome
    welcomeEl.style.display = 'none';

    // Show searching message
    const searchQuery = keywords || article;
    addMessage(`查詢判決書：${searchQuery}`, 'user');

    const typingEl = addTypingIndicator();

    try {
        const res = await fetch('/api/judgments/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keywords, article, court, type, limit: 10 }),
        });

        const data = await res.json();
        removeElement(typingEl);

        if (data.judgments && data.judgments.length > 0) {
            displayJudgments(data.judgments, data.count);
        } else {
            addMessage('未找到相關判決，請嘗試其他關鍵字。', 'bot');
        }
    } catch (error) {
        removeElement(typingEl);
        addMessage('查詢判決時發生錯誤：' + error.message, 'bot');
    }

    scrollToBottom();
};

function displayJudgments(judgments, count) {
    const container = document.createElement('div');
    container.className = 'message bot';

    const label = document.createElement('div');
    label.className = 'message-bubble';
    label.innerHTML = `找到 <strong>${count}</strong> 筆相關判決：`;
    container.appendChild(label);

    judgments.forEach(judgment => {
        const card = createJudgmentCard(judgment);
        container.appendChild(card);
    });

    messagesEl.appendChild(container);
    scrollToBottom();
}

function createJudgmentCard(judgment) {
    const card = document.createElement('div');
    card.className = 'judgment-card';

    // Header
    const header = document.createElement('div');
    header.className = 'judgment-card-header';
    header.onclick = () => card.classList.toggle('expanded');

    const info = document.createElement('div');
    info.className = 'judgment-card-info';
    info.innerHTML = `
        <div class="judgment-case-number">${escapeHtml(judgment.case_number || '判決書')}</div>
        <div class="judgment-meta">
            <span>🏛️ ${escapeHtml(judgment.court || '法院')}</span>
            <span>📅 ${escapeHtml(judgment.date || '日期')}</span>
        </div>
    `;

    const toggle = document.createElement('span');
    toggle.className = 'judgment-card-toggle';
    toggle.textContent = '▼';

    header.appendChild(info);
    header.appendChild(toggle);
    card.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'judgment-card-body';

    // Always show subject/案由
    if (judgment.subject) {
        body.innerHTML += `
            <div class="judgment-section">
                <div class="judgment-section-title">案由</div>
                <div class="judgment-content">${escapeHtml(judgment.subject)}</div>
            </div>
        `;
    }

    // Show summary if available (from parsing)
    if (judgment.summary) {
        body.innerHTML += `
            <div class="judgment-section">
                <div class="judgment-section-title">摘要</div>
                <div class="judgment-content">${escapeHtml(judgment.summary)}</div>
            </div>
        `;
    }

    // Show main text if available (from parsing)
    if (judgment.main_text) {
        body.innerHTML += `
            <div class="judgment-section">
                <div class="judgment-section-title">主文</div>
                <div class="judgment-content">${escapeHtml(judgment.main_text)}</div>
            </div>
        `;
    }

    // Show applicable laws if available (from parsing)
    if (judgment.laws && judgment.laws.length > 0) {
        body.innerHTML += `
            <div class="judgment-section">
                <div class="judgment-section-title">適用法條</div>
                <div class="judgment-content">${judgment.laws.map(l => escapeHtml(l)).join('、')}</div>
            </div>
        `;
    }

    // Add link to view full judgment
    if (judgment.url) {
        body.innerHTML += `
            <div class="judgment-section">
                <a href="${escapeHtml(judgment.url)}" target="_blank" rel="noopener noreferrer"
                   class="judgment-link" style="color: var(--primary); text-decoration: none; display: inline-flex; align-items: center; gap: 6px; margin-top: 8px;">
                    <span>📄</span>
                    <span>查看完整判決書</span>
                    <span style="font-size: 12px;">↗</span>
                </a>
            </div>
        `;
    }

    card.appendChild(body);
    return card;
}

// ── Keyboard Shortcuts ──
function handleKeyboardShortcuts(e) {
    // Ctrl/Cmd + Enter: Send message
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        const query = chatInput.value.trim();
        if (query && !isProcessing) sendMessage(query);
    }

    // Ctrl/Cmd + K: Focus search input
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        chatInput.focus();
    }

    // Ctrl/Cmd + L: Clear conversation
    if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
        e.preventDefault();
        if (confirm('確定要清除所有對話記錄嗎？')) {
            clearConversation();
        }
    }

    // Ctrl/Cmd + H: Show history
    if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
        e.preventDefault();
        showHistory();
    }

    // Ctrl/Cmd + B: Show bookmarks
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        showBookmarks();
    }

    // Ctrl/Cmd + D: Toggle dark mode
    if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        toggleTheme();
    }

    // Ctrl/Cmd + /: Show keyboard shortcuts help
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        showKeyboardShortcutsHelp();
    }

    // Esc: Close modals/dialogs (if any)
    if (e.key === 'Escape') {
        // Close any open modals
        const modals = document.querySelectorAll('.modal, .dialog');
        modals.forEach(modal => modal.remove());
    }

    // Home: Scroll to top
    if (e.key === 'Home' && !chatInput.contains(e.target)) {
        e.preventDefault();
        chatArea.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // End: Scroll to bottom
    if (e.key === 'End' && !chatInput.contains(e.target)) {
        e.preventDefault();
        scrollToBottom();
    }
}

function showKeyboardShortcutsHelp() {
    const shortcuts = [
        { key: 'Ctrl + Enter', desc: '發送訊息' },
        { key: 'Ctrl + K', desc: '聚焦搜索框' },
        { key: 'Ctrl + L', desc: '清除對話' },
        { key: 'Ctrl + H', desc: '顯示歷史記錄' },
        { key: 'Ctrl + B', desc: '顯示收藏' },
        { key: 'Ctrl + D', desc: '切換深色模式' },
        { key: 'Ctrl + /', desc: '顯示快捷鍵說明' },
        { key: 'Home', desc: '滾動到頂部' },
        { key: 'End', desc: '滾動到底部' },
        { key: 'Esc', desc: '關閉彈窗' },
    ];

    const helpHtml = `
        <div class="message bot">
            <div class="message-bubble">
                <strong>⌨️ 鍵盤快捷鍵</strong>
            </div>
            <div class="quick-questions" style="margin-top:12px;max-width:80%;">
                <table style="width:100%;border-collapse:collapse;">
                    ${shortcuts.map(s => `
                        <tr>
                            <td style="padding:8px;border-bottom:1px solid var(--border-light);">
                                <code style="background:var(--bg-secondary);padding:4px 8px;border-radius:4px;font-size:12px;">${s.key}</code>
                            </td>
                            <td style="padding:8px;border-bottom:1px solid var(--border-light);color:var(--text-secondary);">
                                ${s.desc}
                            </td>
                        </tr>
                    `).join('')}
                </table>
                <p style="margin-top:12px;font-size:12px;color:var(--text-muted);">
                    💡 Mac 用戶請使用 Cmd 替代 Ctrl
                </p>
            </div>
        </div>
    `;

    messagesEl.innerHTML += helpHtml;
    welcomeEl.style.display = 'none';
    scrollToBottom();
}

// ── Advanced Search Filters ──
window.toggleFilters = function() {
    const filtersEl = document.getElementById('searchFilters');
    const toggleBtn = document.getElementById('filterToggleBtn');
    const isVisible = filtersEl.classList.contains('visible');

    if (isVisible) {
        filtersEl.classList.remove('visible');
        toggleBtn.classList.remove('active');
    } else {
        filtersEl.classList.add('visible');
        toggleBtn.classList.add('active');
        welcomeEl.style.display = 'none';
    }
};

function initializeFilters() {
    // Chapter filters
    const chapterChips = document.querySelectorAll('#chapterFilters .filter-chip');
    chapterChips.forEach(chip => {
        chip.addEventListener('click', () => {
            chip.classList.toggle('active');
        });
    });

    // Scope filters (single selection)
    const scopeChips = document.querySelectorAll('#scopeFilters .filter-chip');
    scopeChips.forEach(chip => {
        chip.addEventListener('click', () => {
            scopeChips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
        });
    });

    // Status filters (single selection)
    const statusChips = document.querySelectorAll('#statusFilters .filter-chip');
    statusChips.forEach(chip => {
        chip.addEventListener('click', () => {
            statusChips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
        });
    });
}

window.resetFilters = function() {
    // Reset chapter filters
    const chapterChips = document.querySelectorAll('#chapterFilters .filter-chip');
    chapterChips.forEach(chip => chip.classList.remove('active'));

    // Reset scope filter to "all"
    const scopeChips = document.querySelectorAll('#scopeFilters .filter-chip');
    scopeChips.forEach(chip => {
        if (chip.dataset.scope === 'all') {
            chip.classList.add('active');
        } else {
            chip.classList.remove('active');
        }
    });

    // Reset status filter to "active"
    const statusChips = document.querySelectorAll('#statusFilters .filter-chip');
    statusChips.forEach(chip => {
        if (chip.dataset.status === 'active') {
            chip.classList.add('active');
        } else {
            chip.classList.remove('active');
        }
    });

    searchFilters = {
        chapters: [],
        scope: 'all',
        status: 'active'
    };

    showToast('篩選條件已重置', 'success');
};

window.applyFilters = function() {
    // Collect active chapter filters
    const activeChapters = Array.from(document.querySelectorAll('#chapterFilters .filter-chip.active'))
        .map(chip => chip.dataset.chapter);

    // Get active scope
    const activeScope = document.querySelector('#scopeFilters .filter-chip.active')?.dataset.scope || 'all';

    // Get active status
    const activeStatus = document.querySelector('#statusFilters .filter-chip.active')?.dataset.status || 'active';

    searchFilters = {
        chapters: activeChapters,
        scope: activeScope,
        status: activeStatus
    };

    // Update filter button to show active state
    const filterToggleBtn = document.getElementById('filterToggleBtn');
    const hasActiveFilters = activeChapters.length > 0 || activeScope !== 'all' || activeStatus !== 'active';

    if (hasActiveFilters) {
        filterToggleBtn.classList.add('active');
        const filterCount = activeChapters.length + (activeScope !== 'all' ? 1 : 0) + (activeStatus !== 'active' ? 1 : 0);
        filterToggleBtn.querySelector('span').textContent = `篩選 (${filterCount})`;
    } else {
        filterToggleBtn.classList.remove('active');
        filterToggleBtn.querySelector('span').textContent = '篩選';
    }

    // Close filter panel
    document.getElementById('searchFilters').classList.remove('visible');

    showToast('篩選條件已套用', 'success');
    console.log('Active filters:', searchFilters);
};

// ── Related Questions Generation ──
async function generateRelatedQuestions(query, aiResponse, messageElement) {
    try {
        const res = await fetch('/api/related-questions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, response: aiResponse }),
        });

        if (!res.ok) return;

        const data = await res.json();
        const questions = data.questions || [];

        if (questions.length > 0) {
            const relatedQuestionsEl = document.createElement('div');
            relatedQuestionsEl.className = 'related-questions';
            relatedQuestionsEl.innerHTML = `
                <div class="related-questions-header">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
                    </svg>
                    <span>相關問題推薦</span>
                </div>
                <div class="related-questions-list">
                    ${questions.map(q => `
                        <button class="related-question-btn" onclick="askQuestion('${escapeHtml(q).replace(/'/g, "\\'")}')">
                            ${escapeHtml(q)}
                        </button>
                    `).join('')}
                </div>
            `;

            messageElement.appendChild(relatedQuestionsEl);
            scrollToBottom();
        }
    } catch (error) {
        console.error('Failed to generate related questions:', error);
    }
}

// ── Export Conversation ──
function exportConversation() {
    const messages = Array.from(document.querySelectorAll('#messages .message'));

    if (messages.length === 0) {
        showToast('目前沒有對話記錄可以匯出', 'error');
        return;
    }

    // Generate Markdown
    let markdown = '# 台灣法律知識系統 - 對話記錄\n\n';
    markdown += `匯出時間：${new Date().toLocaleString('zh-TW')}\n\n`;
    markdown += '---\n\n';

    messages.forEach((msg, index) => {
        const isUser = msg.classList.contains('user');
        const bubble = msg.querySelector('.message-bubble');

        if (isUser) {
            markdown += `## 👤 使用者\n\n${bubble.textContent.trim()}\n\n`;
        } else {
            markdown += `## 🤖 AI 助手\n\n${bubble.textContent.trim()}\n\n`;
        }

        markdown += '---\n\n';
    });

    markdown += `\n\n_由台灣法律知識系統產生 · ${new Date().toLocaleDateString('zh-TW')}_`;

    // Download as Markdown file
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `法律諮詢記錄_${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('對話記錄已匯出為 Markdown 文件', 'success');
}

// ── Statistics Dashboard ──
function showStatsDashboard() {
    const stats = JSON.parse(localStorage.getItem('usageStats') || '{}');

    if (!stats.totalViews && !searchHistory.length) {
        showToast('尚無使用數據', 'error');
        return;
    }

    // Calculate stats
    const today = new Date().toISOString().split('T')[0];
    const todayQueries = stats.dailyQueries?.[today] || 0;
    const totalQueries = Object.values(stats.dailyQueries || {}).reduce((a, b) => a + b, 0);
    const aiUsage = stats.modeUsage?.ai || 0;
    const searchUsage = stats.modeUsage?.search || 0;
    const totalModeUsage = aiUsage + searchUsage;

    // Get last 7 days queries
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const count = stats.dailyQueries?.[dateStr] || 0;
        last7Days.push({ date: dateStr, count });
    }

    // Top articles from history
    const articleCounts = {};
    searchHistory.forEach(item => {
        const match = item.query.match(/第\s*(\d+)\s*條/);
        if (match) {
            const articleNum = match[1];
            articleCounts[articleNum] = (articleCounts[articleNum] || 0) + 1;
        }
    });

    const topArticles = Object.entries(articleCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([num, count]) => ({ article: `第 ${num} 條`, count }));

    const dashboardHTML = `
        <div class="message bot">
            <div class="stats-dashboard">
                <div class="stats-header">
                    <div class="stats-title">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M3 3v18h18M7 16l4-4 4 4 6-6"/>
                        </svg>
                        <span>使用統計</span>
                    </div>
                    <div class="stats-period">過去 7 天</div>
                </div>

                <div class="stats-grid">
                    <div class="stat-box">
                        <div class="stat-label">今日查詢</div>
                        <div class="stat-value">${todayQueries}</div>
                        <div class="stat-change">次</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-label">總查詢次數</div>
                        <div class="stat-value">${totalQueries}</div>
                        <div class="stat-change">次</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-label">AI 模式</div>
                        <div class="stat-value">${totalModeUsage ? Math.round(aiUsage / totalModeUsage * 100) : 0}%</div>
                        <div class="stat-change">${aiUsage} 次</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-label">搜尋模式</div>
                        <div class="stat-value">${totalModeUsage ? Math.round(searchUsage / totalModeUsage * 100) : 0}%</div>
                        <div class="stat-change">${searchUsage} 次</div>
                    </div>
                </div>

                <div class="stats-chart">
                    <div class="chart-title">📊 每日查詢趨勢</div>
                    <div class="chart-bars">
                        ${last7Days.map(day => {
                            const maxCount = Math.max(...last7Days.map(d => d.count), 1);
                            const height = (day.count / maxCount) * 100;
                            const dateObj = new Date(day.date);
                            const label = (dateObj.getMonth() + 1) + '/' + dateObj.getDate();
                            return `
                                <div class="chart-bar" style="height: ${height}%">
                                    <div class="chart-bar-value">${day.count}</div>
                                    <div class="chart-bar-label">${label}</div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>

                ${topArticles.length > 0 ? `
                    <div class="stats-chart">
                        <div class="chart-title">🔝 最常查詢法條 Top 5</div>
                        <div class="top-items-list">
                            ${topArticles.map((item, i) => `
                                <div class="top-item" onclick="askQuestion('${item.article}')">
                                    <div class="top-item-rank">${i + 1}</div>
                                    <div class="top-item-content">
                                        <div class="top-item-name">${item.article}</div>
                                        <div class="top-item-count">${item.count} 次查詢</div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}

                <p style="margin-top:16px;font-size:12px;color:var(--text-muted);text-align:center;">
                    💡 統計數據儲存在本機瀏覽器中
                </p>
            </div>
        </div>
    `;

    messagesEl.innerHTML += dashboardHTML;
    welcomeEl.style.display = 'none';
    scrollToBottom();
}

// ── Screenshot Capture (Simple Implementation) ──
async function captureMessageScreenshot(messageElement) {
    try {
        // Create a canvas to draw the message
        const bubble = messageElement.querySelector('.message-bubble');
        if (!bubble) return;

        // Create a temporary container with better styling for screenshot
        const container = document.createElement('div');
        container.style.cssText = `
            position: fixed;
            left: -9999px;
            top: 0;
            background: white;
            padding: 24px;
            width: 600px;
            border-radius: 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            font-family: 'Noto Sans TC', sans-serif;
        `;

        // Add logo and content
        container.innerHTML = `
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;padding-bottom:16px;border-bottom:2px solid #e2e8f0;">
                <div style="width:40px;height:40px;background:linear-gradient(135deg,#667eea,#764ba2);border-radius:10px;display:flex;align-items:center;justify-content:center;">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                        <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                        <path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>
                    </svg>
                </div>
                <div>
                    <div style="font-weight:700;font-size:16px;color:#1a202c;">台灣法律知識系統</div>
                    <div style="font-size:11px;color:#718096;">AI Legal Assistant</div>
                </div>
            </div>
            <div style="font-size:14px;line-height:1.8;color:#1a202c;">
                ${bubble.innerHTML}
            </div>
            <div style="margin-top:16px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11px;color:#a0aec0;text-align:center;">
                ${new Date().toLocaleDateString('zh-TW')} · claude.com/code
            </div>
        `;

        document.body.appendChild(container);

        // Use html2canvas if available, otherwise show download prompt
        if (typeof html2canvas !== 'undefined') {
            const canvas = await html2canvas(container, {
                backgroundColor: '#ffffff',
                scale: 2
            });

            // Convert to blob and download
            canvas.toBlob(blob => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `法律諮詢_${new Date().toISOString().slice(0, 10)}.png`;
                a.click();
                URL.revokeObjectURL(url);

                showToast('截圖已下載', 'success');
            });
        } else {
            // Fallback: prompt to install html2canvas or use browser screenshot
            showToast('請使用瀏覽器截圖功能（Ctrl+Shift+S）', 'error');
        }

        document.body.removeChild(container);

    } catch (error) {
        console.error('Screenshot failed:', error);
        showToast('截圖失敗，請使用瀏覽器截圖功能', 'error');
    }
}

// ── Quick Action Functions ──
async function copyToClipboard(text, button) {
    try {
        // Remove markdown formatting for plain text copy
        const plainText = text.replace(/[#*_`\[\]]/g, '');
        await navigator.clipboard.writeText(plainText);

        // Visual feedback
        const originalHTML = button.innerHTML;
        button.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20 6L9 17l-5-5"/>
            </svg>
            <span>已複製</span>
        `;
        button.style.background = 'var(--success)';
        button.style.color = 'white';
        button.style.borderColor = 'var(--success)';

        setTimeout(() => {
            button.innerHTML = originalHTML;
            button.style.background = '';
            button.style.color = '';
            button.style.borderColor = '';
        }, 2000);

        showToast('內容已複製到剪貼簿', 'success');
    } catch (err) {
        console.error('Copy failed:', err);
        showToast('複製失敗，請手動選取複製', 'error');
    }
}

function shareContent(content) {
    const shareText = `台灣法律知識系統 - AI 智能助手\n\n${content}\n\n來源：http://localhost:5003`;

    if (navigator.share) {
        // Use Web Share API if available
        navigator.share({
            title: '台灣法律知識系統',
            text: shareText,
        }).then(() => {
            showToast('分享成功', 'success');
        }).catch(err => {
            if (err.name !== 'AbortError') {
                copyToClipboardFallback(shareText);
            }
        });
    } else {
        // Fallback: copy to clipboard
        copyToClipboardFallback(shareText);
    }
}

async function copyToClipboardFallback(text) {
    try {
        await navigator.clipboard.writeText(text);
        showToast('分享內容已複製到剪貼簿', 'success');
    } catch (err) {
        showToast('分享失敗', 'error');
    }
}

function toggleBookmark(content, messageEl, button) {
    const timestamp = new Date().toISOString();
    const bookmark = {
        content,
        timestamp,
        id: Date.now().toString()
    };

    // Check if already bookmarked
    const isBookmarked = bookmarks.some(b => b.content === content);

    if (isBookmarked) {
        // Remove bookmark
        bookmarks = bookmarks.filter(b => b.content !== content);
        button.classList.remove('bookmarked');
        button.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
            </svg>
            <span>收藏</span>
        `;
        showToast('已取消收藏', 'success');
    } else {
        // Add bookmark
        bookmarks.unshift(bookmark);
        button.classList.add('bookmarked');
        button.innerHTML = `
            <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
            </svg>
            <span>已收藏</span>
        `;
        showToast('已加入收藏', 'success');
    }

    saveToStorage('bookmarks', bookmarks);
}

// ── Theme Toggle ──
function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';

    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeIcon(newTheme);

    showToast(newTheme === 'dark' ? '已切換至深色模式' : '已切換至淺色模式', 'success');
}

function updateThemeIcon(theme) {
    if (!themeToggle) return;

    const icon = theme === 'dark'
        ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="5"/>
            <line x1="12" y1="1" x2="12" y2="3"/>
            <line x1="12" y1="21" x2="12" y2="23"/>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
            <line x1="1" y1="12" x2="3" y2="12"/>
            <line x1="21" y1="12" x2="23" y2="12"/>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
           </svg>`
        : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
           </svg>`;

    themeToggle.innerHTML = icon;
    themeToggle.title = theme === 'dark' ? '切換至淺色模式' : '切換至深色模式';
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icon = type === 'success'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';

    toast.innerHTML = `${icon}<span>${message}</span>`;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideOutDown 0.3s ease-out';
        setTimeout(() => {
            document.body.removeChild(toast);
        }, 300);
    }, 3000);
}

// ── Article Compare Functions ──
window.openCompareModal = function() {
    const modal = document.getElementById('compareModal');
    modal.classList.add('visible');
    document.getElementById('articleA').focus();
};

window.closeCompareModal = function() {
    const modal = document.getElementById('compareModal');
    modal.classList.remove('visible');
};

window.compareArticles = async function() {
    const articleA = document.getElementById('articleA').value.trim();
    const articleB = document.getElementById('articleB').value.trim();
    const mode = document.getElementById('compareMode').value;

    if (!articleA || !articleB) {
        showToast('請輸入兩個法條號碼', 'error');
        return;
    }

    // Close modal
    closeCompareModal();

    // Hide welcome
    welcomeEl.style.display = 'none';

    // Show query message
    addMessage(`對比法條：第${articleA}條 vs 第${articleB}條`, 'user');

    const typingEl = addTypingIndicator();

    try {
        // Use AI mode to compare articles
        const query = mode === 'content'
            ? `請比較公司法第${articleA}條和第${articleB}條的內容差異`
            : mode === 'related'
            ? `請分析公司法第${articleA}條和第${articleB}條的關聯性`
            : `請找出與公司法第${articleA}條和第${articleB}條相似的其他條文`;

        // Use existing AI functionality
        await handleAIResponse(query, typingEl);
    } catch (error) {
        removeElement(typingEl);
        addMessage('法條對比時發生錯誤：' + error.message, 'bot');
    }

    scrollToBottom();
};
