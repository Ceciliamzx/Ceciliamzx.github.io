const express = require('express');
const cors = require('cors');
const { kv } = require('@vercel/kv');
const app = express();

// 中间件
app.use(cors());
app.use(express.json());

// 1. 埋点接口：数据永久存入KV
app.post('/api/events', async (req, res) => {
  try {
    const event = req.body;
    event.timestamp = new Date().toISOString();
    await kv.lpush('events', event);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. 后台获取埋点数据：从KV读取
app.get('/api/events', async (req, res) => {
  try {
    const events = await kv.lrange('events', 0, -1);
    res.json(events.reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. 用户反馈接口
app.post('/api/feedback', async (req, res) => {
  try {
    const feedback = req.body;
    feedback.timestamp = new Date().toISOString();
    await kv.lpush('feedback', feedback);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. 后台获取反馈
app.get('/api/feedback', async (req, res) => {
  try {
    const feedback = await kv.lrange('feedback', 0, -1);
    res.json(feedback.reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. FAQ管理接口
app.get('/api/faq', async (req, res) => {
  const faq = await kv.get('faq') || [];
  res.json(faq);
});
app.post('/api/faq', async (req, res) => {
  await kv.set('faq', req.body);
  res.json({ success: true });
});

// 必须导出app，禁止加app.listen
// ===================== 新增后台统计接口 =====================
app.get('/api/dashboard', async (req, res) => {
  try {
    // 读取埋点和FAQ数据
    const events = store.events || [];
    const faq = store.faq || [];

    // 统计数据（真实计算访问/提问/点击）
    const analytics = {
      visits: events.filter(e => e.type === 'page_view').length,
      questions: events.filter(e => e.type === 'chat_send').length,
      buttonClicks: events.filter(e => e.type === 'tab_switch' || e.type === 'lang_switch').length
    };
    const faqCount = faq.length;

    res.json({ analytics, faqCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ==========================================================
module.exports = app;
