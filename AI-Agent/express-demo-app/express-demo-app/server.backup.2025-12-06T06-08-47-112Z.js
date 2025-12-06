require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

app.get('/', (req, res) => {
  res.send('Hello from Express!');
});

app.get('/api/tasks', (req, res) => {
  const tasks = [
    { id: 1, title: 'Learn Express', completed: false },
    { id: 2, title: 'Build Task App', completed: false },
    { id: 3, title: 'Deploy to Server', completed: false }
  ];
  res.json(tasks);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});