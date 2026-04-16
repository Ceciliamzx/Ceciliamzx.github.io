const express = require('express');
const cors = require('cors');
const app = express();

// 必须加：解析JSON请求体，解决接口报错
app.use(cors());
app.use(express.json());

// 初始化内存存储，包含所有字段，避免undefined
let store = {
  events: [],
  feedback: [],
  faq: [] // 必须初始化，不然FAQ存不住
};

// 1. 埋点接口（已正常，保留）
app.post('/api/events', (req, res) => {
  try {
    const event = req.body;
    event.timestamp = new Date().toISOString();
    store.events.push(event);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. 读取埋点接口（已正常，保留）
app.get('/api/events', (req, res) => {
  try {
    res.json(store.events.reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. 用户反馈接口（已正常，保留）
app.post('/api/feedback', (req, res) => {
  try {
    const feedback = req.body;
    feedback.timestamp = new Date().toISOString();
    store.feedback.push(feedback);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. 读取反馈接口（已正常，保留）
app.get('/api/feedback', (req, res) => {
  try {
    res.json(store.feedback.reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. FAQ接口（修正路径为/faqs，和admin里的调用路径完全匹配！）
app.get('/api/faqs', (req, res) => {
  try {
    res.json(store.faq);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post('/api/faqs', (req, res) => {
  try {
    store.faq = req.body;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Vercel强制要求：导出app，不能加app.listen
module.exports = app;
