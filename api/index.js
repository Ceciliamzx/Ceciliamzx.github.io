const express = require('express');
const cors = require('cors');
const { kv } = require('@vercel/kv');

const app = express();

app.use(cors());
app.use(express.json());

function toSafeArray(value) {
  return Array.isArray(value) ? value : [];
}

app.post('/api/events', async (req, res) => {
  try {
    const event = {
      ...req.body,
      timestamp: new Date().toISOString()
    };
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

// FAQ：统一使用 /api/faqs
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
    const nextFaqs = faqs.filter(item => Number(item.id) !== id);

    await kv.set('faqs', nextFaqs);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 给后台页留兼容接口，避免 users/settings 面板报错
app.get('/api/users', async (req, res) => {
  try {
    const events = await kv.lrange('events', 0, -1);
    const users = events
      .filter(item => item.type === 'user_visit')
      .map((item, index) => ({
        id: item.id || index + 1,
        ua: item.ua || '',
        time: item.timestamp || ''
      }))
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
    res.json({
      siteName: 'London Uncovered',
      defaultLanguage: 'zh',
      answerMode: 'deep'
    });
  }
});

module.exports = app;
