const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const BLYNK_TOKEN = process.env.BLYNK_TOKEN;
const BLYNK_BASE_URL = 'https://blynk.cloud/external/api';

const razorpay = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET,
});

app.post('/create-order', async (req, res) => {
  try {
    const { amount, vendorId } = req.body;
    const order = await razorpay.orders.create({
      amount: amount * 100,
      currency: 'INR',
      notes: { vendorId }
    });
    res.json({ success: true, order });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.post('/webhook', async (req, res) => {
  const secret = RAZORPAY_KEY_SECRET;
  const signature = req.headers['x-razorpay-signature'];
  const body = JSON.stringify(req.body);

  const expected = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  if (signature !== expected) {
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const event = req.body.event;

  if (event === 'payment.captured') {
    await axios.get(BLYNK_BASE_URL + '/update?token=' + BLYNK_TOKEN + '&v1=1');

    setTimeout(async () => {
      await axios.get(BLYNK_BASE_URL + '/update?token=' + BLYNK_TOKEN + '&v1=0');
    }, 30000);
  }

  res.json({ status: 'ok' });
});

app.post('/refund', async (req, res) => {
  try {
    const { paymentId } = req.body;
    const refund = await razorpay.payments.refund(paymentId, {});
    res.json({ success: true, refund });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.get('/', (req, res) => res.send('Water Vending Server Running!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));
