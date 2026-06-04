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

// ─── Tool Implementations ────────────────────────────────────────────────────

async function toolSearchWiki(query, lang) {
  const wiki = toSafeArray(await kv.get('wiki'));
  if (!wiki.length) return '（知识库暂无内容）';

  const q = (query || '').toLowerCase();
  const words = q.split(/[\s，,？?！!。.]+/).filter(w => w.length > 1);

  const scored = wiki
    .map(w => {
      const haystack = [w.title_zh, w.title_en, ...(w.tags || []), w.body_zh, w.body_en]
        .join(' ').toLowerCase();
      const score = words.filter(word => haystack.includes(word)).length;
      return { ...w, score };
    })
    .filter(w => w.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (!scored.length) return `没有找到与"${query}"相关的知识库文章。`;

  return scored.map(w =>
    lang === 'zh'
      ? `## ${w.title_zh}\n${w.body_zh}`
      : `## ${w.title_en}\n${w.body_en}`
  ).join('\n\n---\n\n');
}

async function toolSearchFaq(query, lang) {
  const faqs = toSafeArray(await kv.get('faqs'));
  if (!faqs.length) return '（FAQ 暂无内容）';

  const q = (query || '').toLowerCase();
  const words = q.split(/[\s，,？?！!。.]+/).filter(w => w.length > 1);

  const scored = faqs
    .map(f => {
      const haystack = [f.question_zh, f.question_en, f.answer_zh, f.answer_en]
        .join(' ').toLowerCase();
      const score = words.filter(word => haystack.includes(word)).length;
      return { ...f, score };
    })
    .filter(f => f.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (!scored.length) return `没有找到与"${query}"相关的 FAQ。`;

  return scored.map(f =>
    lang === 'zh'
      ? `Q: ${f.question_zh}\nA: ${f.answer_zh}`
      : `Q: ${f.question_en}\nA: ${f.answer_en}`
  ).join('\n\n');
}

async function toolGetContext(lang) {
  const [faqs, wiki] = await Promise.all([
    kv.get('faqs').then(toSafeArray),
    kv.get('wiki').then(toSafeArray)
  ]);

  const faqTitles = faqs.map(f => lang === 'zh' ? f.question_zh : f.question_en).filter(Boolean);
  const wikiTitles = wiki.map(w => lang === 'zh' ? w.title_zh : w.title_en).filter(Boolean);

  return JSON.stringify({
    faq_count: faqs.length,
    wiki_count: wiki.length,
    faq_topics: faqTitles.slice(0, 10),
    wiki_topics: wikiTitles.slice(0, 10)
  }, null, 2);
}

// ─── Tool Definitions (OpenAI function-calling format) ────────────────────────

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_wiki',
      description: '在知识库中搜索与问题相关的文章。当用户问到具体文化话题时使用此工具获取详细背景知识。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索关键词，例如"下午茶历史"、"维多利亚排屋"'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_faq',
      description: '在 FAQ 数据库中搜索常见问题的标准答案。当用户的问题可能已有标准解答时使用。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '搜索关键词，例如"炸鱼薯条"、"地铁礼仪"'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_knowledge_overview',
      description: '获取当前知识库的概览，包括已有的 FAQ 主题和 Wiki 文章标题列表。在不确定知识库有哪些内容时使用。',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  }
];

// ─── Self-Improvement: Load Learned Context ──────────────────────────────────

async function loadLearnedContext(question, lang) {
  try {
    const [rules, examples] = await Promise.all([
      kv.get('agent_rules').then(toSafeArray),
      kv.get('good_examples').then(toSafeArray)
    ]);

    const q = (question || '').toLowerCase();
    const words = q.split(/[\s，,？?！!。.]+/).filter(w => w.length > 1);

    const relevant = examples
      .map(ex => ({
        ...ex,
        score: words.filter(w => (ex.question || '').toLowerCase().includes(w)).length
      }))
      .filter(ex => ex.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);

    let context = '';
    if (rules.length) {
      context += lang === 'zh'
        ? `\n\n【从用户反馈中积累的改进规则】\n${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
        : `\n\n[Learned Improvement Rules from user feedback]\n${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;
    }
    if (relevant.length) {
      context += lang === 'zh'
        ? `\n\n【高质量回答示例（参考风格）】\n${relevant.map(ex => `Q: ${ex.question}\nA: ${ex.answer}`).join('\n\n')}`
        : `\n\n[High-quality answer examples]\n${relevant.map(ex => `Q: ${ex.question}\nA: ${ex.answer}`).join('\n\n')}`;
    }
    return context;
  } catch (_) {
    return '';
  }
}

// ─── Self-Improvement: Reflect on Badcases ───────────────────────────────────

async function reflect() {
  const badcases = toSafeArray(await kv.get('badcases')).slice(-10);
  if (badcases.length < 3) return { skipped: true, reason: 'not enough badcases (need ≥ 3)' };

  const existingRules = toSafeArray(await kv.get('agent_rules'));

  const prompt = `你是一个AI文化助手的自我优化系统。以下是用户评价为"差"的问答记录：

${badcases.map((b, i) => `【案例${i + 1}】\n问：${b.question}\n答：${b.answer}`).join('\n\n')}

已有优化规则：
${existingRules.length ? existingRules.map((r, i) => `${i + 1}. ${r}`).join('\n') : '（暂无）'}

请分析这些失败案例暴露的问题，生成3-5条具体可操作的改进规则（不与已有规则重复，聚焦回答质量和伦敦文化准确性）。
只输出JSON数组格式，例如：["规则1", "规则2", "规则3"]`;

  const completion = await deepseek.chat.completions.create({
    model: 'deepseek-chat',
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }]
  });

  const content = completion.choices[0].message.content || '';
  const match = content.match(/\[[\s\S]*?\]/);
  if (!match) return { skipped: true, reason: 'parse failed', raw: content };

  let newRules = [];
  try { newRules = JSON.parse(match[0]); } catch (_) { return { skipped: true, reason: 'json parse failed' }; }

  const allRules = [...existingRules, ...newRules].slice(-20); // 最多保留 20 条
  await kv.set('agent_rules', allRules);

  await kv.lpush('reflection_log', {
    timestamp: new Date().toISOString(),
    badcases_count: badcases.length,
    new_rules: newRules,
    total_rules: allRules.length
  });
  await kv.ltrim('reflection_log', 0, 49);
  await kv.set('badcases', []); // 清空已处理的 badcase

  return { success: true, new_rules: newRules, total_rules: allRules.length };
}

// ─── Agent Loop ───────────────────────────────────────────────────────────────

async function runAgentLoop(messages, lang, mode, maxSteps = 5) {
  const isZh = lang === 'zh';

  // 加载当前问题（最后一条 user 消息）用于匹配相关示例
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  const learnedContext = await loadLearnedContext(lastUserMsg?.content || '', lang);

  const formatGuide = isZh
    ? (mode === 'deep'
        ? '请用以下四个部分回答，每部分2-4句话：\n【历史背景】\n【社会语境】\n【当代变化】\n【具体案例】'
        : '请用简洁的一段话回答（100字以内）。')
    : (mode === 'deep'
        ? 'Structure your answer with these four sections, 2-4 sentences each:\n[Historical Background]\n[Social Context]\n[Contemporary Change]\n[Concrete Example]'
        : 'Reply in one concise paragraph (under 100 words).');

  const systemPrompt = isZh
    ? `你是「读懂伦敦 London Uncovered」的AI文化助手，专门帮助留学生、游客和外来工作者理解伦敦城市文化。

你有以下工具可以使用：
- search_wiki：搜索知识库文章（详细背景知识）
- search_faq：搜索常见问题标准答案
- get_knowledge_overview：查看知识库有哪些内容

工作方式：先判断是否需要查阅知识库，如需要则调用工具获取资料，再基于资料给出回答。

${formatGuide}

回答要准确、有洞察力、贴近实际生活。${learnedContext}`
    : `You are the AI cultural assistant for "London Uncovered", helping students, visitors, and global workers understand London's urban culture.

You have the following tools:
- search_wiki: Search the knowledge base for detailed background
- search_faq: Search FAQ for standard answers
- get_knowledge_overview: View what topics are in the knowledge base

Workflow: Decide if you need to check the knowledge base, call tools if needed, then synthesize an answer.

${formatGuide}

Be insightful and grounded in real life.${learnedContext}`;

  const fullMessages = [
    { role: 'system', content: systemPrompt },
    ...messages
  ];

  let toolCallCount = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  const toolCallLog = [];

  for (let step = 0; step < maxSteps; step++) {
    const completion = await deepseek.chat.completions.create({
      model: 'deepseek-chat',
      max_tokens: mode === 'deep' ? 800 : 300,
      tools: TOOLS,
      tool_choice: 'auto',
      messages: fullMessages
    });

    totalTokensIn += completion.usage?.prompt_tokens || 0;
    totalTokensOut += completion.usage?.completion_tokens || 0;

    const choice = completion.choices[0];
    const assistantMsg = choice.message;
    fullMessages.push(assistantMsg);

    // Done — LLM gave a final text answer
    if (choice.finish_reason === 'stop' || !assistantMsg.tool_calls?.length) {
      return {
        answer: assistantMsg.content || '',
        tool_calls: toolCallLog,
        tokens_in: totalTokensIn,
        tokens_out: totalTokensOut
      };
    }

    // Execute each tool call
    for (const tc of assistantMsg.tool_calls) {
      toolCallCount++;
      const fnName = tc.function.name;
      let args = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch (_) {}

      let result = '';
      const t0 = Date.now();

      if (fnName === 'search_wiki') {
        result = await toolSearchWiki(args.query, lang);
      } else if (fnName === 'search_faq') {
        result = await toolSearchFaq(args.query, lang);
      } else if (fnName === 'get_knowledge_overview') {
        result = await toolGetContext(lang);
      } else {
        result = `未知工具: ${fnName}`;
      }

      toolCallLog.push({ tool: fnName, args, duration_ms: Date.now() - t0 });

      fullMessages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result
      });
    }
  }

  // Fallback if max steps exceeded
  return {
    answer: isZh
      ? '抱歉，这个问题需要更多信息才能回答，请换个方式提问。'
      : 'Sorry, I need more context to answer this. Please try rephrasing.',
    tool_calls: toolCallLog,
    tokens_in: totalTokensIn,
    tokens_out: totalTokensOut
  };
}

// ─── Session Management ───────────────────────────────────────────────────────

const SESSION_MAX_TURNS = 20; // keep last N user+assistant pairs
const SESSION_TTL = 60 * 60 * 2; // 2 hours

async function getSession(sessionId) {
  if (!sessionId) return [];
  try {
    return toSafeArray(await kv.get(`session:${sessionId}`));
  } catch (_) {
    return [];
  }
}

async function saveSession(sessionId, messages) {
  if (!sessionId) return;
  try {
    // Keep only the last SESSION_MAX_TURNS turns (user + assistant pairs)
    const trimmed = messages.slice(-SESSION_MAX_TURNS * 2);
    await kv.set(`session:${sessionId}`, trimmed, { ex: SESSION_TTL });
  } catch (_) {}
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

// ─── Chat (Agent) ─────────────────────────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  if (!process.env.DEEPSEEK_API_KEY) {
    return res.status(503).json({ error: 'LLM not configured' });
  }

  const t0 = Date.now();
  const { question, lang = 'zh', mode = 'deep', sessionId } = req.body || {};

  if (!question || !question.trim()) {
    return res.status(400).json({ error: 'question is required' });
  }

  const q = question.trim();

  // Load conversation history
  const history = await getSession(sessionId);

  // Append current user message
  const messages = [
    ...history,
    { role: 'user', content: q }
  ];

  // Run agent loop
  let result;
  try {
    result = await runAgentLoop(messages, lang, mode);
  } catch (err) {
    return res.status(502).json({ error: 'Agent loop failed: ' + err.message });
  }

  // Save updated history (append assistant reply)
  if (sessionId) {
    const updatedHistory = [
      ...history,
      { role: 'user', content: q },
      { role: 'assistant', content: result.answer }
    ];
    await saveSession(sessionId, updatedHistory);
  }

  const total_ms = Date.now() - t0;

  // Store metrics
  try {
    await kv.lpush('metrics', {
      id: Date.now(),
      question: q.slice(0, 200),
      lang,
      mode,
      session_id: sessionId || null,
      tool_calls: result.tool_calls,
      tool_call_count: result.tool_calls.length,
      total_ms,
      tokens_in: result.tokens_in,
      tokens_out: result.tokens_out,
      timestamp: new Date().toISOString()
    });
    await kv.ltrim('metrics', 0, 499);
  } catch (_) {}

  res.json({
    answer: result.answer,
    tool_calls: result.tool_calls,
    metrics: {
      total_ms,
      tokens_in: result.tokens_in,
      tokens_out: result.tokens_out,
      tool_call_count: result.tool_calls.length
    }
  });
});

// ─── Rating & Self-Improvement ───────────────────────────────────────────────

app.post('/api/rating', async (req, res) => {
  const { question, answer, rating, dwell_ms } = req.body || {};
  if (!question || !rating) return res.status(400).json({ error: 'question and rating required' });

  try {
    if (rating === 'good') {
      const examples = toSafeArray(await kv.get('good_examples'));
      examples.unshift({ question, answer, timestamp: new Date().toISOString() });
      await kv.set('good_examples', examples.slice(0, 50));
    } else if (rating === 'bad') {
      const badcases = toSafeArray(await kv.get('badcases'));
      badcases.unshift({ question, answer, dwell_ms, timestamp: new Date().toISOString() });
      const updated = badcases.slice(0, 50);
      await kv.set('badcases', updated);
      // 积累 5 条 badcase 自动触发反思（异步，不阻塞响应）
      if (updated.length >= 5) reflect().catch(() => {});
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 手动触发反思（admin 用）
app.post('/api/reflect', async (req, res) => {
  try {
    const result = await reflect();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 查看进化状态（agent rules + examples + badcases + logs）
app.get('/api/agent-rules', async (req, res) => {
  try {
    const [rules, examples, badcases, logs] = await Promise.all([
      kv.get('agent_rules').then(toSafeArray),
      kv.get('good_examples').then(toSafeArray),
      kv.get('badcases').then(toSafeArray),
      kv.lrange('reflection_log', 0, 9)
    ]);
    res.json({
      rules,
      examples: examples.slice(0, 10),
      badcases: badcases.slice(0, 10),
      logs
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除单条规则
app.delete('/api/agent-rules/:index', async (req, res) => {
  try {
    const idx = Number(req.params.index);
    const rules = toSafeArray(await kv.get('agent_rules'));
    if (idx < 0 || idx >= rules.length) return res.status(400).json({ error: 'invalid index' });
    rules.splice(idx, 1);
    await kv.set('agent_rules', rules);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Session Reset ────────────────────────────────────────────────────────────

app.delete('/api/session/:sessionId', async (req, res) => {
  try {
    await kv.del(`session:${req.params.sessionId}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
        avg_tokens_in: avg('tokens_in'),
        avg_tokens_out: avg('tokens_out'),
        avg_tool_calls: avg('tool_call_count'),
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
