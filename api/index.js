const express = require('express');
const cors = require('cors');
const { kv } = require('@vercel/kv');
const OpenAI = require('openai');

const app = express();
app.use(cors());
app.use(express.json());

const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY || '',
  baseURL: 'https://api.deepseek.com'
});

function toSafeArray(value) {
  return Array.isArray(value) ? value : [];
}

// Simple keyword relevance scorer
function scoreMatch(text, query) {
  const t = (text || '').toLowerCase();
  const words = query.toLowerCase().split(/[\s，,？?！!。.]+/).filter(w => w.length > 1);
  return words.filter(w => t.includes(w)).length;
}

// ─── Events ──────────────────────────────────────────────────────────────────

app.post('/api/events', async (req, res) => {
  try {
    const event = { ...req.body, timestamp: new Date().toISOString() };
    await kv.lpush('events', event);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/events', async (req, res) => {
  try {
    const events = await kv.lrange('events', 0, -1);
    res.json(events.reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Feedback ─────────────────────────────────────────────────────────────────

app.post('/api/feedback', async (req, res) => {
  try {
    const feedback = {
      id: Date.now(),
      message: req.body?.message || '',
      email: req.body?.email || '',
      reply: req.body?.reply || '',
      timestamp: new Date().toISOString()
    };
    await kv.lpush('feedback', feedback);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/feedback', async (req, res) => {
  try {
    const feedback = await kv.lrange('feedback', 0, -1);
    res.json(feedback.reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── FAQs ─────────────────────────────────────────────────────────────────────

app.get('/api/faqs', async (req, res) => {
  try {
    const faqs = await kv.get('faqs');
    res.json(toSafeArray(faqs));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/faqs', async (req, res) => {
  try {
    const faqs = toSafeArray(await kv.get('faqs'));
    const newFaq = {
      id: Date.now(),
      question_zh: (req.body?.question_zh || '').trim(),
      question_en: (req.body?.question_en || '').trim(),
      answer_zh: (req.body?.answer_zh || '').trim(),
      answer_en: (req.body?.answer_en || '').trim()
    };
    if (!newFaq.question_zh || !newFaq.question_en) {
      return res.status(400).json({ error: 'question_zh and question_en are required' });
    }
    faqs.push(newFaq);
    await kv.set('faqs', faqs);
    res.json({ success: true, item: newFaq });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/faqs/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const faqs = toSafeArray(await kv.get('faqs'));
    await kv.set('faqs', faqs.filter(item => Number(item.id) !== id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Wiki Knowledge Base ──────────────────────────────────────────────────────

app.get('/api/wiki', async (req, res) => {
  try {
    res.json(toSafeArray(await kv.get('wiki')));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/wiki', async (req, res) => {
  try {
    const wiki = toSafeArray(await kv.get('wiki'));
    const tags = Array.isArray(req.body?.tags)
      ? req.body.tags
      : (req.body?.tags || '').split(',').map(t => t.trim()).filter(Boolean);
    const item = {
      id: Date.now(),
      title_zh: (req.body?.title_zh || '').trim(),
      title_en: (req.body?.title_en || '').trim(),
      body_zh: (req.body?.body_zh || '').trim(),
      body_en: (req.body?.body_en || '').trim(),
      tags,
      updated_at: new Date().toISOString()
    };
    if (!item.title_zh) return res.status(400).json({ error: 'title_zh is required' });
    wiki.push(item);
    await kv.set('wiki', wiki);
    res.json({ success: true, item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/wiki/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const wiki = toSafeArray(await kv.get('wiki'));
    const idx = wiki.findIndex(w => Number(w.id) === id);
    if (idx === -1) return res.status(404).json({ error: 'not found' });
    const tags = Array.isArray(req.body?.tags)
      ? req.body.tags
      : (req.body?.tags || wiki[idx].tags || []);
    wiki[idx] = { ...wiki[idx], ...req.body, tags, id, updated_at: new Date().toISOString() };
    await kv.set('wiki', wiki);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/wiki/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const wiki = toSafeArray(await kv.get('wiki'));
    await kv.set('wiki', wiki.filter(w => Number(w.id) !== id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Chat (Claude) ────────────────────────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  if (!process.env.DEEPSEEK_API_KEY) {
    return res.status(503).json({ error: 'LLM not configured' });
  }

  const t0 = Date.now();
  const { question, lang = 'zh', mode = 'deep' } = req.body || {};
  if (!question || !question.trim()) {
    return res.status(400).json({ error: 'question is required' });
  }

  // ── Retrieval phase ──
  const t1 = Date.now();
  const [faqs, wiki] = await Promise.all([
    kv.get('faqs').then(toSafeArray),
    kv.get('wiki').then(toSafeArray)
  ]);

  const q = question.trim();

  const topFaqs = faqs
    .map(f => ({
      ...f,
      score: scoreMatch(f.question_zh + ' ' + f.question_en, q)
    }))
    .filter(f => f.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const topWiki = wiki
    .map(w => ({
      ...w,
      score: scoreMatch(
        [w.title_zh, w.title_en, ...(w.tags || []), w.body_zh, w.body_en].join(' '),
        q
      )
    }))
    .filter(w => w.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const retrieval_ms = Date.now() - t1;

  // ── Build context ──
  const isZh = lang === 'zh';

  const faqContext = topFaqs.length
    ? topFaqs.map(f =>
        isZh
          ? `Q: ${f.question_zh}\nA: ${f.answer_zh}`
          : `Q: ${f.question_en}\nA: ${f.answer_en}`
      ).join('\n\n')
    : '';

  const wikiContext = topWiki.length
    ? topWiki.map(w =>
        isZh
          ? `## ${w.title_zh}\n${w.body_zh}`
          : `## ${w.title_en}\n${w.body_en}`
      ).join('\n\n')
    : '';

  const formatGuide = isZh
    ? (mode === 'deep'
        ? '请用以下四个部分回答，每部分2-4句话：\n【历史背景】\n【社会语境】\n【当代变化】\n【具体案例】'
        : '请用简洁的一段话回答（100字以内）。')
    : (mode === 'deep'
        ? 'Structure your answer with these four sections, 2-4 sentences each:\n[Historical Background]\n[Social Context]\n[Contemporary Change]\n[Concrete Example]'
        : 'Reply in one concise paragraph (under 100 words).');

  const contextBlock = [
    faqContext ? (isZh ? `=== 相关FAQ ===\n${faqContext}` : `=== Relevant FAQs ===\n${faqContext}`) : '',
    wikiContext ? (isZh ? `=== 知识库 ===\n${wikiContext}` : `=== Knowledge Base ===\n${wikiContext}`) : ''
  ].filter(Boolean).join('\n\n');

  const systemPrompt = isZh
    ? `你是「读懂伦敦 London Uncovered」的AI文化助手，专门帮助留学生、游客和外来工作者理解伦敦城市文化。回答要准确、有洞察力、贴近实际生活。

${formatGuide}

${contextBlock ? `参考资料（如相关请优先使用）：\n${contextBlock}` : ''}`
    : `You are the AI cultural assistant for "London Uncovered", helping students, visitors, and global workers understand London's urban culture. Be insightful and grounded in real life.

${formatGuide}

${contextBlock ? `Reference material (use when relevant):\n${contextBlock}` : ''}`;

  // ── LLM call ──
  const t2 = Date.now();
  let completion;
  try {
    completion = await deepseek.chat.completions.create({
      model: 'deepseek-chat',
      max_tokens: mode === 'deep' ? 800 : 300,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: q }
      ]
    });
  } catch (err) {
    return res.status(502).json({ error: 'LLM call failed: ' + err.message });
  }

  const llm_ms = Date.now() - t2;
  const total_ms = Date.now() - t0;
  const answer = completion.choices[0].message.content;
  const tokens_in = completion.usage.prompt_tokens;
  const tokens_out = completion.usage.completion_tokens;

  // ── Store metrics ──
  try {
    await kv.lpush('metrics', {
      id: Date.now(),
      question: q.slice(0, 200),
      lang,
      mode,
      retrieval_ms,
      llm_ms,
      total_ms,
      tokens_in,
      tokens_out,
      faq_hits: topFaqs.length,
      wiki_hits: topWiki.length,
      timestamp: new Date().toISOString()
    });
    await kv.ltrim('metrics', 0, 499);
  } catch (_) {
    // metrics write failure is non-fatal
  }

  res.json({ answer, metrics: { retrieval_ms, llm_ms, total_ms, tokens_in, tokens_out } });
});

// ─── Metrics ──────────────────────────────────────────────────────────────────

app.get('/api/metrics', async (req, res) => {
  try {
    const raw = await kv.lrange('metrics', 0, 99);
    const list = raw.reverse();
    if (!list.length) return res.json({ summary: null, recent: [] });

    const avg = key => Math.round(list.reduce((s, m) => s + (m[key] || 0), 0) / list.length);

    res.json({
      summary: {
        count: list.length,
        avg_total_ms: avg('total_ms'),
        avg_retrieval_ms: avg('retrieval_ms'),
        avg_llm_ms: avg('llm_ms'),
        avg_tokens_in: avg('tokens_in'),
        avg_tokens_out: avg('tokens_out'),
        total_tokens: list.reduce((s, m) => s + (m.tokens_in || 0) + (m.tokens_out || 0), 0)
      },
      recent: list.slice(0, 20)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Compat endpoints ─────────────────────────────────────────────────────────

app.get('/api/users', async (req, res) => {
  try {
    const events = await kv.lrange('events', 0, -1);
    const users = events
      .filter(item => item.type === 'user_visit')
      .map((item, index) => ({ id: item.id || index + 1, ua: item.ua || '', time: item.timestamp || '' }))
      .reverse();
    res.json(users);
  } catch (err) {
    res.json([]);
  }
});

app.get('/api/settings', async (req, res) => {
  try {
    const settings = (await kv.get('settings')) || {
      siteName: 'London Uncovered',
      defaultLanguage: 'zh',
      answerMode: 'deep'
    };
    res.json(settings);
  } catch (err) {
    res.json({ siteName: 'London Uncovered', defaultLanguage: 'zh', answerMode: 'deep' });
  }
});

module.exports = app;
