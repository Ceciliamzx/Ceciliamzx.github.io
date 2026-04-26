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
// 获取所有FAQ
app.get('/api/faq', async (req, res) => {
  const faq = await kv.get('faq') || []; // 获取FAQ，默认为空数组
  res.json(faq);
});

// 添加新的FAQ
app.post('/api/faq', async (req, res) => {
  try {
    const newFaq = req.body;
    const existingFaq = await kv.get('faq') || []; // 获取现有FAQ
    existingFaq.push(newFaq); // 将新FAQ添加到现有FAQ数组中
    await kv.set('faq', existingFaq); // 更新FAQ数据
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 必须导出app，禁止加app.listen
module.exports = app;
