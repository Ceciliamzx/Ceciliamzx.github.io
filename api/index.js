const express = require("express");
const fs = require('fs-extra');
const path = require("path");

const app = express();
const storePath = path.join(__dirname, '../data/store.json');

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function loadStore() {
  const raw = fs.readFileSync(STORE_PATH, "utf8");
  return JSON.parse(raw);
}

function saveStore(data) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), "utf8");
}

app.get("/api/dashboard", (req, res) => {
  const db = loadStore();
  res.json({
    analytics: db.analytics,
    feedbackCount: db.feedback.length,
    faqCount: db.faqs.length,
    userCount: db.users.length
  });
});

app.get("/api/faqs", (req, res) => {
  const db = loadStore();
  res.json(db.faqs);
});

app.post("/api/faqs", (req, res) => {
  const db = loadStore();
  const faq = req.body;
  const id = Date.now();
  db.faqs.push({ id, ...faq });
  saveStore(db);
  res.json({ ok: true, id });
});

app.put("/api/faqs/:id", (req, res) => {
  const db = loadStore();
  const id = Number(req.params.id);
  db.faqs = db.faqs.map((item) => (item.id === id ? { ...item, ...req.body, id } : item));
  saveStore(db);
  res.json({ ok: true });
});

app.delete("/api/faqs/:id", (req, res) => {
  const db = loadStore();
  const id = Number(req.params.id);
  db.faqs = db.faqs.filter((item) => item.id !== id);
  saveStore(db);
  res.json({ ok: true });
});

app.get("/api/feedback", (req, res) => {
  const db = loadStore();
  res.json(db.feedback);
});

app.post("/api/feedback", (req, res) => {
  const db = loadStore();
  db.feedback.push({
    id: Date.now(),
    message: req.body.message || "",
    email: req.body.email || "",
    reply: "",
    createdAt: new Date().toISOString()
  });
  saveStore(db);
  res.json({ ok: true });
});

app.put("/api/feedback/:id/reply", (req, res) => {
  const db = loadStore();
  const id = Number(req.params.id);
  db.feedback = db.feedback.map((item) =>
    item.id === id ? { ...item, reply: req.body.reply || "" } : item
  );
  saveStore(db);
  res.json({ ok: true });
});

app.get("/api/users", (req, res) => {
  const db = loadStore();
  res.json(db.users);
});

app.post("/api/events", (req, res) => {
  const db = loadStore();
  const { type } = req.body;
  if (type === "visit") db.analytics.visits += 1;
  if (type === "question") db.analytics.questions += 1;
  if (type === "button_click") db.analytics.buttonClicks += 1;
  if (type === "user_visit") {
    db.users.push({
      id: Date.now(),
      ua: req.body.ua || "unknown",
      time: new Date().toISOString()
    });
  }
  saveStore(db);
  res.json({ ok: true });
});

app.get("/api/settings", (req, res) => {
  res.json({
    projectName: "读懂伦敦 London Uncovered",
    defaultLang: "zh",
    backendMode: "lightweight"
  });
});
module.exports = app;

