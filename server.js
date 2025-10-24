import express from 'express';
import dotenv from 'dotenv';
import configRouter from './routes/config.js';
import purchaseRouter from './routes/purchase.js';
import tokenRouter from './routes/token.js';
import { fileURLToPath } from 'url';
import path from 'path';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.set('trust proxy', 'loopback');
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, 'public')));

app.use('/be-token', (req, res, next) => {
  const ip = (req.ip || '').replace('::ffff:', '');
  if (ip !== '127.0.0.1') {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
});

app.use('/', configRouter);
app.use('/', tokenRouter);
app.use('/', purchaseRouter);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'demo-3ds.html'));
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`HTTP server listening on http://127.0.0.1:${PORT}`);
});
